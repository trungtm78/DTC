import { featureOf, isRiskyFeature } from '@machvon/kernel';
import type { OperationKind, TenantContext } from '@machvon/kernel';
import type { EntitlementStore } from '@machvon/db';

export interface EntitlementVerdict {
  allowed: boolean;
  /** FEATURE_OFF, LICENSE_GRACE, LICENSE_EXPIRED, LICENSE_SUSPENDED or TENANT_POLICY when not allowed. */
  reason?: string;
}

/** What the policy guard asks before it decides a permission: is the plan feature behind it on for the tenant? */
export interface EntitlementGate {
  check(tenant: TenantContext, permission: string, method: string, now: Date): Promise<EntitlementVerdict>;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The kind of operation the entitlement judges: exports are their own kind, any other non-read method is a write. */
export function operationKindOf(feature: string, method: string): OperationKind {
  if (feature === 'export') return 'export';
  return READ_METHODS.has(method.toUpperCase()) ? 'read' : 'write';
}

/**
 * The gate over the entitlement store. A permission that no plan feature gates is always allowed (no database read);
 * a risky feature (AI, campaigns) reads the database, every other one the per-tenant cache.
 */
export class StoreEntitlementGate implements EntitlementGate {
  constructor(private readonly store: EntitlementStore) {}

  async check(tenant: TenantContext, permission: string, method: string, now: Date): Promise<EntitlementVerdict> {
    const feature = featureOf(permission);
    if (feature === undefined) return { allowed: true };
    const kind = operationKindOf(feature, method);
    return isRiskyFeature(feature) ? this.store.allowedFromDatabase(tenant, feature, kind, now) : this.store.allowed(tenant, feature, kind, now);
  }
}
