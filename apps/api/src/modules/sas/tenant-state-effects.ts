import type { AuthzCache, EntitlementCache } from '@machvon/db';
import type { TenantRuntimeSource } from '../../session/tenant-runtime';

/** Injection token of what a change of the state of a tenant must drop in this process. */
export const TENANT_STATE_EFFECTS = Symbol('TENANT_STATE_EFFECTS');

export interface TenantStateEffects {
  /** Forgets everything this process holds that depends on the state of the tenant. */
  invalidate(tenantId: string): Promise<void>;
}

export interface TenantStateEffectsDeps {
  runtime: TenantRuntimeSource;
  entitlementCache: EntitlementCache;
  authzCache: AuthzCache;
}

/**
 * The live state (what the tenant may do now), the cached entitlements and the cached effective access of every member
 * all depend on the status of the tenant (BR-IAM-03): a suspension or a resumption drops the three together.
 */
export class CacheTenantStateEffects implements TenantStateEffects {
  constructor(private readonly deps: TenantStateEffectsDeps) {}

  async invalidate(tenantId: string): Promise<void> {
    this.deps.runtime.invalidate(tenantId);
    await this.deps.entitlementCache.invalidate(tenantId);
    await this.deps.authzCache.invalidateTenant(tenantId);
  }
}
