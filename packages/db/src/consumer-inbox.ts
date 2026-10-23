import { createHash } from 'node:crypto';
import { DomainError, NOOP_ALERTS, verifyTenantContext } from '@machvon/kernel';
import type { AlertSink, TenantContext } from '@machvon/kernel';
import type { TenantDatabase, TenantTx } from './tenant-database.ts';

/** Identity of every consumer: an event has no user behind it (ST-KERNEL-022 pattern). */
export const WORKER_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000000';

/** Raised when a delivery's tenant context does not verify or does not match the tenant it claims. */
export const OUTBOX_CONTEXT_TAMPERED_ALERT = 'OUTBOX_CONTEXT_TAMPERED';

/** The part of an outbox delivery a consumer needs: the event, its tenant and the signed worker context for it. */
export interface SignedDelivery {
  id: string;
  tenantId: string;
  /** Token from signTenantContext for { tenantId, WORKER_MEMBERSHIP_ID, 0 }, attached by the relay. */
  tenantContext: string;
}

export interface ConsumeSecurity {
  /** The key the relay signs deliveries with (at least 32 bytes). */
  signingKey: Buffer;
  alerts?: AlertSink;
  /** Seconds since the epoch; tests inject it to expire tokens. */
  now?: () => number;
}

const INSERT_SQL = `insert into machvon.integration_event_inbox
    (tenant_id, id, provider, event_key, payload_hash, payload_reference, received_at, status, signature_key_id, processed_at)
  values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1, $2, $3, $4, now(), 'PROCESSED', 'internal', now())
  on conflict (tenant_id, provider, event_key) do nothing
  returning id`;

function tamperedWith(alerts: AlertSink, eventId: string, reason: 'INVALID_TOKEN' | 'TENANT_MISMATCH'): DomainError {
  // The alert names the event and the reason only: the token and the claimed tenant stay out of logs and alerts.
  alerts.raise(OUTBOX_CONTEXT_TAMPERED_ALERT, { eventId, reason });
  return new DomainError('TENANT_CONTEXT_INVALID', 400);
}

/**
 * The worker context a delivery carries, verified against the relay's key. A token that does not verify, or one
 * signed for a tenant other than the delivery's tenant id, is a tampered delivery: it raises the alert and fails
 * with TENANT_CONTEXT_INVALID before anything touches the database.
 */
export function verifyDelivery(delivery: SignedDelivery, security: ConsumeSecurity): TenantContext {
  const alerts = security.alerts ?? NOOP_ALERTS;
  if (typeof delivery.tenantContext !== 'string') throw tamperedWith(alerts, delivery.id, 'INVALID_TOKEN');
  let context: TenantContext;
  try {
    context = verifyTenantContext(delivery.tenantContext, security.signingKey, security.now);
  } catch (error) {
    if (error instanceof DomainError) throw tamperedWith(alerts, delivery.id, 'INVALID_TOKEN');
    throw error;
  }
  if (context.tenantId !== delivery.tenantId || context.membershipId !== WORKER_MEMBERSHIP_ID) {
    throw tamperedWith(alerts, delivery.id, 'TENANT_MISMATCH');
  }
  return context;
}

/**
 * Runs `work` at most once per (consumer, event) with an inbox row written in the same transaction as the
 * work, so a failed run leaves no row and a redelivery after a crash is recognised as a duplicate. The tenant
 * comes from the verified signed context of the delivery, never from its plain tenant id.
 */
export async function consumeOnce(
  database: TenantDatabase,
  delivery: SignedDelivery,
  consumer: string,
  work: (tx: TenantTx) => Promise<void>,
  security: ConsumeSecurity,
): Promise<'processed' | 'duplicate'> {
  if (consumer.trim() === '') throw new Error('consumer name is required');
  const context = verifyDelivery(delivery, security);
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
