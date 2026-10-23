import { ENTITLEMENT_CHANGED_EVENT, consumeOnce } from '@machvon/db';
import type { AuthzCache, ConsumeSecurity, EntitlementCache, OutboxDelivery, TenantDatabase } from '@machvon/db';
import { asUuid } from '@machvon/kernel';
import type { EntitlementPushPort } from './entitlement-push';

export const ENTITLEMENT_CONSUMER = 'entitlement-cache';

export interface EntitlementConsumerDeps {
  database: TenantDatabase;
  cache: EntitlementCache;
  authzCache: AuthzCache;
  push: EntitlementPushPort;
  security: ConsumeSecurity;
}

type Delivery = Pick<OutboxDelivery, 'id' | 'tenantId' | 'tenantContext' | 'type' | 'payload'>;

/**
 * Consumer of `sas.entitlement.changed.v1`: drops the tenant's cached entitlements and cached effective access (BR-IAM-03
 * is the permissions intersected with the entitlement), then tells connected clients once. The cache is cleared inside the
 * inbox transaction so a crash after the inbox row cannot leave a stale entry; a redelivery is recognised and does nothing.
 */
export class EntitlementChangedConsumer {
  constructor(private readonly deps: EntitlementConsumerDeps) {}

  async handle(delivery: Delivery): Promise<'processed' | 'duplicate' | 'ignored'> {
    if (delivery.type !== ENTITLEMENT_CHANGED_EVENT) return 'ignored';
    const hash = typeof delivery.payload.entitlements_hash === 'string' ? delivery.payload.entitlements_hash : '';
    // The payload names the tenant too; a delivery whose payload disagrees with its signed tenant is not ours to act on.
    if (asUuid(delivery.payload.tenant_id) !== delivery.tenantId) return 'ignored';
    const { database, cache, authzCache, push, security } = this.deps;
    const outcome = await consumeOnce(
      database,
      delivery,
      ENTITLEMENT_CONSUMER,
      async () => {
        await cache.invalidate(delivery.tenantId);
        await authzCache.invalidateTenant(delivery.tenantId);
      },
      security,
    );
    if (outcome === 'processed') push.publish(delivery.tenantId, hash);
    return outcome;
  }
}
