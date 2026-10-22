import { NOOP_ALERTS, NOOP_METRICS, OUTBOX_BATCH_SIZE, OUTBOX_LAG_ALERT_SECONDS, OUTBOX_MAX_ATTEMPTS, outboxDelaySeconds } from '@machvon/kernel';
import type { AlertSink, MetricsSink } from '@machvon/kernel';
import type { Pool, PoolClient } from 'pg';

export interface OutboxDelivery {
  id: string;
  tenantId: string;
  type: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
  eventKey: string;
  correlationId: string;
  attempts: number;
}

export interface OutboxRelayOptions {
  metrics?: MetricsSink;
  alerts?: AlertSink;
  batchSize?: number;
}

export interface RelayRunResult {
  published: number;
  retried: number;
  dead: number;
}

interface ClaimedRow {
  id: string;
  tenant_id: string;
  type: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: string;
  payload: Record<string, unknown>;
  event_key: string;
  correlation_id: string;
  attempts: number;
}

const CLAIM_SQL = `select id, tenant_id, type, schema_version, aggregate_type, aggregate_id, aggregate_version::text as aggregate_version,
    payload, event_key, correlation_id, attempts
  from machvon.outbox_event
  where status = 'PENDING' and next_attempt_at <= now()
  order by next_attempt_at, created_at
  limit $1
  for update skip locked`;

const MARK_PUBLISHED_SQL = "update machvon.outbox_event set status = 'PUBLISHED', published_at = now() where tenant_id = $1 and id = $2";
const MARK_FAILED_SQL = `update machvon.outbox_event
  set attempts = $3, status = $4, last_error = $5, next_attempt_at = now() + make_interval(secs => $6)
  where tenant_id = $1 and id = $2`;
const OLDEST_PENDING_SQL = `select coalesce(extract(epoch from now() - min(created_at)), 0)::float8 as seconds
  from machvon.outbox_event where status = 'PENDING'`;

function toDelivery(row: ClaimedRow): OutboxDelivery {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    schemaVersion: row.schema_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: Number(row.aggregate_version),
    payload: row.payload,
    eventKey: row.event_key,
    correlationId: row.correlation_id,
    attempts: row.attempts,
  };
}

// Only the class name is stored: messages can carry personal data or SQL text.
function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}

/** Rolls back and returns undefined, or the failure when the connection must be discarded. */
async function rollback(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query('ROLLBACK');
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error('outbox relay rollback failed');
  }
}

/**
 * Publishes pending outbox events at least once. Events are claimed and marked in one transaction, so a relay
 * that dies mid-batch leaves every claimed event PENDING and consumers must deduplicate (consumeOnce).
 * `pool` must connect as machvon_outbox_relay.
 */
export class OutboxRelay {
  private readonly pool: Pool;
  private readonly publish: (delivery: OutboxDelivery) => Promise<void>;
  private readonly metrics: MetricsSink;
  private readonly alerts: AlertSink;
  private readonly batchSize: number;

  constructor(pool: Pool, publish: (delivery: OutboxDelivery) => Promise<void>, options: OutboxRelayOptions = {}) {
    this.pool = pool;
    this.publish = publish;
    this.metrics = options.metrics ?? NOOP_METRICS;
    this.alerts = options.alerts ?? NOOP_ALERTS;
    this.batchSize = options.batchSize ?? OUTBOX_BATCH_SIZE;
  }

  /** Claims one batch, publishes it and reports the lag; rejects when the connection is lost mid-batch. */
  async runOnce(): Promise<RelayRunResult> {
    const counts = await this.processBatch();
    const seconds = await this.oldestPendingSeconds();
    this.metrics.gauge('outbox_oldest_pending_seconds', seconds);
    if (seconds > OUTBOX_LAG_ALERT_SECONDS) this.alerts.raise('OUTBOX_LAG', { oldestPendingSeconds: seconds });
    return counts;
  }

  async oldestPendingSeconds(): Promise<number> {
    const result = await this.pool.query<{ seconds: number }>(OLDEST_PENDING_SQL);
    return Number(result.rows[0]?.seconds ?? 0);
  }

  private async processBatch(): Promise<RelayRunResult> {
    const client = await this.pool.connect();
    // A killed connection emits 'error' on the client; the failing query reports it, so the event is only absorbed here.
    const absorb = (): void => undefined;
    client.on('error', absorb);
    let discard: Error | undefined;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<ClaimedRow>(CLAIM_SQL, [this.batchSize]);
      const counts: RelayRunResult = { published: 0, retried: 0, dead: 0 };
      for (const row of rows) await this.deliver(client, row, counts);
      await client.query('COMMIT');
      return counts;
    } catch (error) {
      discard = await rollback(client);
      throw error;
    } finally {
      client.removeListener('error', absorb);
      client.release(discard);
    }
  }

  private async deliver(client: PoolClient, row: ClaimedRow, counts: RelayRunResult): Promise<void> {
    try {
      await this.publish(toDelivery(row));
    } catch (error) {
      const attempts = row.attempts + 1;
      const dead = attempts >= OUTBOX_MAX_ATTEMPTS;
      await client.query(MARK_FAILED_SQL, [row.tenant_id, row.id, attempts, dead ? 'DEAD' : 'PENDING', errorClassOf(error), outboxDelaySeconds(attempts)]);
      if (dead) {
        counts.dead += 1;
        this.metrics.increment('outbox_dead_total');
      } else {
        counts.retried += 1;
        this.metrics.increment('outbox_retried_total');
      }
      return;
    }
    await client.query(MARK_PUBLISHED_SQL, [row.tenant_id, row.id]);
    counts.published += 1;
    this.metrics.increment('outbox_published_total');
  }
}
