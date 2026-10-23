import { tenantKey } from '@machvon/kernel';
import type { EffectiveAccess, GrantView } from '@machvon/kernel';

/**
 * Cache of computed effective access, keyed by tenant, membership and the `scope_version` the entry was computed
 * for (`authz:{membership}:{sv}` under the tenant prefix). A key carries the version, so a request that knows a
 * newer version can never read an older entry.
 */
export interface AuthzCache {
  get(tenantId: string, membershipId: string, scopeVersion: number): Promise<EffectiveAccess | undefined>;
  set(access: EffectiveAccess, tenantId: string, ttlSeconds: number): Promise<void>;
  /** Drops every version cached for the membership. */
  invalidate(tenantId: string, membershipId: string): Promise<void>;
  /** Drops every entry of the tenant: a change of its entitlements or plan changes what any member may do (BR-IAM-03). */
  invalidateTenant(tenantId: string): Promise<void>;
}

interface StoredGrant extends Omit<GrantView, 'effectiveFrom' | 'effectiveUntil'> {
  effectiveFrom: string;
  effectiveUntil: string | null;
}

interface StoredAccess extends Omit<EffectiveAccess, 'grants'> {
  grants: StoredGrant[];
}

function serialise(access: EffectiveAccess): string {
  return JSON.stringify(access);
}

function revive(text: string): EffectiveAccess {
  const stored = JSON.parse(text) as StoredAccess;
  return {
    ...stored,
    grants: stored.grants.map((grant) => ({
      ...grant,
      effectiveFrom: new Date(grant.effectiveFrom),
      effectiveUntil: grant.effectiveUntil === null ? null : new Date(grant.effectiveUntil),
    })),
  };
}

const keyOf = (tenantId: string, membershipId: string, scopeVersion: number): string =>
  tenantKey(tenantId, 'authz', membershipId, String(scopeVersion));

const tenantPrefix = (tenantId: string): string => `${tenantKey(tenantId, 'authz')}:`;

const membershipPrefix = (tenantId: string, membershipId: string): string => `${tenantKey(tenantId, 'authz', membershipId)}:`;

/** In-process cache for tests and single-node use; a Redis-backed one replaces it behind the same port. */
export class InMemoryAuthzCache implements AuthzCache {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private readonly now: () => number;
  // Earliest expiry among the stored entries: a write only sweeps once something has actually lapsed.
  private earliestExpiry = Number.POSITIVE_INFINITY;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async get(tenantId: string, membershipId: string, scopeVersion: number): Promise<EffectiveAccess | undefined> {
    return this.read(keyOf(tenantId, membershipId, scopeVersion));
  }

  async set(access: EffectiveAccess, tenantId: string, ttlSeconds: number): Promise<void> {
    const now = this.now();
    if (now >= this.earliestExpiry) this.sweep(now);
    const expiresAt = now + ttlSeconds * 1000;
    this.entries.set(keyOf(tenantId, access.membershipId, access.scopeVersion), { value: serialise(access), expiresAt });
    this.earliestExpiry = Math.min(this.earliestExpiry, expiresAt);
  }

  /** Number of stored entries, including expired ones that no write has swept yet. */
  size(): number {
    return this.entries.size;
  }

  async invalidate(tenantId: string, membershipId: string): Promise<void> {
    const prefix = membershipPrefix(tenantId, membershipId);
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  async invalidateTenant(tenantId: string): Promise<void> {
    const prefix = tenantPrefix(tenantId);
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  // Drops every lapsed entry, so superseded versions and memberships that are never read again cannot pile up.
  private sweep(now: number): void {
    let earliest = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) this.entries.delete(key);
      else earliest = Math.min(earliest, entry.expiresAt);
    }
    this.earliestExpiry = earliest;
  }

  private read(key: string): EffectiveAccess | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return revive(entry.value);
  }
}
