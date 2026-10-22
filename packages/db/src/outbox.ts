import type { TenantTx } from './tenant-database.ts';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  type: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
  eventKey: string;
  correlationId: string;
  causationId?: string;
}

const INSERT_SQL = `insert into machvon.outbox_event
    (tenant_id, id, aggregate_id, type, schema_version, payload, created_at, aggregate_type, aggregate_version, event_key, correlation_id, causation_id)
  values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1, $2, $3, $4::jsonb, now(), $5, $6, $7, $8, $9)
  on conflict (tenant_id, event_key) do nothing
  returning id`;

/**
 * Writes an event to the outbox inside the command transaction, so it is published if and only if the
 * command commits. The tenant comes from the transaction's `app.tenant_id`. A second call with the same
 * `eventKey` writes nothing and reports the existing event with `duplicate: true`.
 */
export async function enqueueOutbox(tx: TenantTx, event: OutboxEventInput): Promise<{ id: string; duplicate: boolean }> {
  const inserted = await tx.query<{ id: string }>(INSERT_SQL, [
    event.aggregateId,
    event.type,
    event.schemaVersion,
    JSON.stringify(event.payload),
    event.aggregateType,
    event.aggregateVersion,
    event.eventKey,
    event.correlationId,
    event.causationId ?? null,
  ]);
  const created = inserted[0];
  if (created !== undefined) return { id: created.id, duplicate: false };
  const existing = await tx.query<{ id: string }>('select id from machvon.outbox_event where event_key = $1', [event.eventKey]);
  const [row] = existing;
  if (row === undefined) throw new Error('outbox event vanished after a key conflict');
  return { id: row.id, duplicate: true };
}
