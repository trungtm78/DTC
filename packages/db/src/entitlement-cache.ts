import { tenantKey } from '@machvon/kernel';
import type { FeatureEntry, LicenseMode, Override, TenantAccessPolicy } from '@machvon/kernel';

/** What the entitlement decision needs about one tenant: the latest version, its overrides, the license and the tenant state. */
export interface EntitlementSnapshot {
  /** 0 when the tenant has no entitlement version yet. */
  versionNo: number;
  hash: string;
  features: FeatureEntry[];
  overrides: Override[];
  licenseMode: LicenseMode;
  tenantPolicy: TenantAccessPolicy;
}

/**
 * Cache of entitlement snapshots, one entry per tenant under `t:{tenant}:ent`. A change of the tenant's entitlements
 * clears its entry (the `sas.entitlement.changed.v1` consumer); the time to live bounds how long a missed event can matter.
 */
export interface EntitlementCache {
  get(tenantId: string): Promise<EntitlementSnapshot | undefined>;
  set(tenantId: string, snapshot: EntitlementSnapshot, ttlSeconds: number): Promise<void>;
  invalidate(tenantId: string): Promise<void>;
}

const keyOf = (tenantId: string): string => tenantKey(tenantId, 'ent');

/** In-process cache for tests and single-node use; a Redis-backed one replaces it behind the same port. */
export class InMemoryEntitlementCache implements EntitlementCache {
  private readonly entries = new Map<string, { snapshot: EntitlementSnapshot; expiresAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async get(tenantId: string): Promise<EntitlementSnapshot | undefined> {
    const key = keyOf(tenantId);
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.snapshot;
  }

  async set(tenantId: string, snapshot: EntitlementSnapshot, ttlSeconds: number): Promise<void> {
    this.entries.set(keyOf(tenantId), { snapshot, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  async invalidate(tenantId: string): Promise<void> {
    this.entries.delete(keyOf(tenantId));
  }

  /** The stored keys, for tests that check the tenant prefix. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  clear(): void {
    this.entries.clear();
  }
}
