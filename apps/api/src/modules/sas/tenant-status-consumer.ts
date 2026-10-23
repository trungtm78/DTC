import { consumeOnce } from '@machvon/db';
import type { ConsumeSecurity, OutboxDelivery, TenantDatabase } from '@machvon/db';
import { asUuid } from '@machvon/kernel';
import type { TenantStateEffects } from './tenant-state-effects';

export const TENANT_STATUS_CHANGED_EVENT = 'sas.tenant.status_changed.v1';
export const TENANT_STATUS_CONSUMER = 'tenant-status-cache';

export interface TenantStatusConsumerDeps {
  database: TenantDatabase;
  effects: TenantStateEffects;
  security: ConsumeSecurity;
}

type Delivery = Pick<OutboxDelivery, 'id' | 'tenantId' | 'tenantContext' | 'type' | 'payload'>;

/**
 * Consumer of `sas.tenant.status_changed.v1` for every process other than the one that ran the command: it drops what the
 * process holds about the tenant, so the suspension reaches it without waiting for the short life of its caches. A
 * redelivery is recognised by the inbox and does nothing.
 */
export class TenantStatusChangedConsumer {
  constructor(private readonly deps: TenantStatusConsumerDeps) {}

  async handle(delivery: Delivery): Promise<'processed' | 'duplicate' | 'ignored'> {
    if (delivery.type !== TENANT_STATUS_CHANGED_EVENT) return 'ignored';
    // The payload names the tenant too; a delivery whose payload disagrees with its signed tenant is not ours to act on.
    if (asUuid(delivery.payload.tenant_id) !== delivery.tenantId) return 'ignored';
    const { database, effects, security } = this.deps;
    return consumeOnce(database, delivery, TENANT_STATUS_CONSUMER, () => effects.invalidate(delivery.tenantId), security);
  }
}
