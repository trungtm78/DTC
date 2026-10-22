import { IDEMPOTENCY_LOCK_SECONDS, IDEMPOTENCY_TTL_HOURS } from '@machvon/kernel';
import type { IdempotencyTtl, TenantContext } from '@machvon/kernel';
import type { TenantDatabase, TenantTx } from './tenant-database.ts';

export type StoredResponse =
  | { kind: 'success'; body: unknown }
  | { kind: 'problem'; code: string; status: number; detail?: string; extensions?: Record<string, unknown> };

export type BeginResult =
  | { kind: 'started'; recordId: string }
  | { kind: 'replay'; httpStatus: number; response: StoredResponse }
  | { kind: 'conflict' }
  | { kind: 'in_progress'; retryAfterSeconds: 2 };

export interface BeginInput {
  operation: string;
  keyHash: string;
  requestHash: string;
  ttl: IdempotencyTtl;
}

export interface CompletedOutcome {
  httpStatus: number;
  response: StoredResponse;
  resourceType?: string;
  resourceId?: string;
}

export type FinishOutcome = { retryable: true } | ({ retryable: false } & Pick<CompletedOutcome, 'httpStatus' | 'response'>);

const RETRY_AFTER_SECONDS = 2;

// Expiry and lock are computed by the database clock, so the table CHECK (72 hours to 7 days after
// created_at) never sees client clock skew.
const INSERT_SQL = `insert into machvon.idempotency_record
    (tenant_id, id, subject_id, operation, key_hash, request_hash, response_ref, status, expires_at, locked_until)
  values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1::uuid, $2, $3, $4, '{}'::jsonb,
    'IN_PROGRESS', now() + make_interval(hours => $5::int), now() + make_interval(secs => $6::double precision))
  on conflict (tenant_id, subject_id, operation, key_hash) do nothing
  returning id`;

const SELECT_SQL = `select id, request_hash, status, http_status, response_ref,
    coalesce(locked_until > now(), false) as locked, expires_at <= now() as expired
  from machvon.idempotency_record
  where subject_id = $1::uuid and operation = $2 and key_hash = $3
  for update`;

// A fresh created_at keeps the new expiry inside the table CHECK when an expired record is reused.
const RESTART_EXPIRED_SQL = `update machvon.idempotency_record
  set request_hash = $2, status = 'IN_PROGRESS', response_ref = '{}'::jsonb, http_status = null,
      resource_type = null, resource_id = null, completed_at = null, created_at = now(),
      expires_at = now() + make_interval(hours => $3::int), locked_until = now() + make_interval(secs => $4::double precision)
  where id = $1::uuid`;

const TAKE_OVER_SQL = `update machvon.idempotency_record
  set status = 'IN_PROGRESS', locked_until = now() + make_interval(secs => $2::double precision), completed_at = null
  where id = $1::uuid`;

interface ExistingRow {
  id: string;
  request_hash: string;
  status: string;
  http_status: number | null;
  response_ref: StoredResponse;
  locked: boolean;
  expired: boolean;
}

/**
 * Idempotency records of BR-PLT-02. `begin` commits an IN_PROGRESS record before the command runs,
 * `completeInTx` writes the response inside the command transaction so effects and response commit
 * together, and `finishOutsideTx` settles a command whose transaction rolled back.
 */
export class IdempotencyStore {
  private readonly database: TenantDatabase;

  constructor(database: TenantDatabase) {
    this.database = database;
  }

  begin(ctx: TenantContext, input: BeginInput): Promise<BeginResult> {
    return this.database.withTenant(ctx, async (tx) => {
      const ttlHours = IDEMPOTENCY_TTL_HOURS[input.ttl];
      const inserted = await tx.query<{ id: string }>(INSERT_SQL, [
        ctx.membershipId,
        input.operation,
        input.keyHash,
        input.requestHash,
        ttlHours,
        IDEMPOTENCY_LOCK_SECONDS,
      ]);
      const created = inserted[0];
      if (created !== undefined) return { kind: 'started', recordId: created.id };

      const [existing] = await tx.query<ExistingRow>(SELECT_SQL, [ctx.membershipId, input.operation, input.keyHash]);
      // The row was just seen as conflicting and the lock is held until this transaction ends, so it exists.
      if (existing === undefined) throw new Error('idempotency record vanished while locked');

      if (existing.expired) {
        await tx.query(RESTART_EXPIRED_SQL, [existing.id, input.requestHash, ttlHours, IDEMPOTENCY_LOCK_SECONDS]);
        return { kind: 'started', recordId: existing.id };
      }
      if (existing.request_hash !== input.requestHash) return { kind: 'conflict' };
      if (existing.status === 'COMPLETED' && existing.http_status !== null) {
        return { kind: 'replay', httpStatus: existing.http_status, response: existing.response_ref };
      }
      if (existing.status === 'IN_PROGRESS' && existing.locked) {
        return { kind: 'in_progress', retryAfterSeconds: RETRY_AFTER_SECONDS };
      }
      // FAILED_RETRYABLE, or IN_PROGRESS whose owner crashed and let the lock lapse.
      await tx.query(TAKE_OVER_SQL, [existing.id, IDEMPOTENCY_LOCK_SECONDS]);
      return { kind: 'started', recordId: existing.id };
    });
  }

  async completeInTx(tx: TenantTx, recordId: string, outcome: CompletedOutcome): Promise<void> {
    await tx.query(
      `update machvon.idempotency_record
         set status = 'COMPLETED', http_status = $2, response_ref = $3::jsonb, resource_type = $4, resource_id = $5::uuid,
             completed_at = now(), locked_until = null
       where id = $1::uuid`,
      [recordId, outcome.httpStatus, JSON.stringify(outcome.response), outcome.resourceType ?? null, outcome.resourceId ?? null],
    );
  }

  async finishOutsideTx(ctx: TenantContext, recordId: string, outcome: FinishOutcome): Promise<void> {
    await this.database.withTenant(ctx, async (tx) => {
      if (outcome.retryable) {
        await tx.query(
          `update machvon.idempotency_record set status = 'FAILED_RETRYABLE', locked_until = null
           where id = $1::uuid and status = 'IN_PROGRESS'`,
          [recordId],
        );
        return;
      }
      await tx.query(
        `update machvon.idempotency_record
           set status = 'COMPLETED', http_status = $2, response_ref = $3::jsonb, completed_at = now(), locked_until = null
         where id = $1::uuid and status = 'IN_PROGRESS'`,
        [recordId, outcome.httpStatus, JSON.stringify(outcome.response)],
      );
    });
  }

  async purgeExpired(ctx: TenantContext): Promise<number> {
    const rows = await this.database.withTenant(ctx, (tx) =>
      tx.query<{ n: number }>(
        `with removed as (delete from machvon.idempotency_record where expires_at <= now() returning 1)
         select count(*)::int as n from removed`,
      ),
    );
    return rows[0]?.n ?? 0;
  }
}
