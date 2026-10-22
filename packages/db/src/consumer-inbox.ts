import { createHash } from 'node:crypto';
import type { TenantContext } from '@machvon/kernel';
import type { TenantDatabase, TenantTx } from './tenant-database.ts';

/** Identity of every consumer: an event has no user behind it (ST-KERNEL-022 pattern). */
export const WORKER_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000000';

const INSERT_SQL = `insert into machvon.integration_event_inbox
    (tenant_id, id, provider, event_key, payload_hash, payload_reference, received_at, status, signature_key_id, processed_at)
  values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1, $2, $3, $4, now(), 'PROCESSED', 'internal', now())
  on conflict (tenant_id, provider, event_key) do nothing
  returning id`;

/**
 * Runs `work` at most once per (consumer, event) with an inbox row written in the same transaction as the
 * work, so a failed run leaves no row and a redelivery after a crash is recognised as a duplicate.
 */
export async function consumeOnce(
  database: TenantDatabase,
  delivery: { id: string; tenantId: string },
  consumer: string,
  work: (tx: TenantTx) => Promise<void>,
): Promise<'processed' | 'duplicate'> {
  if (consumer.trim() === '') throw new Error('consumer name is required');
  const context: TenantContext = { tenantId: delivery.tenantId, membershipId: WORKER_MEMBERSHIP_ID, scopeVersion: 0 };
  const payloadHash = createHash('sha256').update(delivery.id).digest('hex');
  return database.withTenant(context, async (tx) => {
    const inserted = await tx.query<{ id: string }>(INSERT_SQL, [
      `consumer:${consumer}`,
      delivery.id,
      payloadHash,
      `outbox_event:${delivery.id}`,
    ]);
    if (inserted.length === 0) return 'duplicate';
    await work(tx);
    return 'processed';
  });
}
