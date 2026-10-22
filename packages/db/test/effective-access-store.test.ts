import type { TenantContext } from '@machvon/kernel';
import { InMemoryAuthzCache } from '../src/authz-cache';
import { EffectiveAccessStore } from '../src/effective-access-store';
import type { TenantDatabase, TenantTx } from '../src/tenant-database';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, grantId, memberId, unitId } from './support/authz-fixtures';

// Wraps the tenant database to remember which SQL texts ran, so a cache hit is observable.
class SpyDatabase {
  readonly statements: string[] = [];
  constructor(private readonly inner: TenantDatabase) {}

  withTenant<T>(ctx: TenantContext, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.inner.withTenant(ctx, (tx) =>
      work({
        query: <R>(sql: string, params?: unknown[]): Promise<R[]> => {
          this.statements.push(sql);
          return tx.query<R>(sql, params);
        },
      }),
    );
  }

  grantReads(): number {
    return this.statements.filter((sql) => sql.includes('role_grant')).length;
  }
}

describe('EffectiveAccessStore', () => {
  const harness = new AuthzHarness();
  let clock = 1_000_000;
  let spy: SpyDatabase;
  let cache: InMemoryAuthzCache;
  let store: EffectiveAccessStore;
  const increments: string[] = [];

  beforeAll(async () => {
    await harness.start();
    for (const tenant of [TENANT_A, TENANT_B]) {
      await harness.seedUnits(tenant, [
        { n: 1, path: '/u1/' },
        { n: 2, path: '/u1/u2/', parent: 1 },
        { n: 3, path: '/u1/u3/', parent: 1 },
      ]);
      await harness.seedRole(tenant, 1, 'UNIT_ADMIN', ['iam.unit.manage', 'iam.member.*'], 70);
      await harness.seedRole(tenant, 2, 'MEMBER', ['profile.self'], 5);
    }
    // Tenant A: member 1 Active with a subtree grant, a tenant grant and a revoked grant; member 2 Suspended; member 3 expired.
    await harness.seedMembership(TENANT_A, 1, 1);
    await harness.seedMembership(TENANT_A, 2, 1, { status: 'Suspended' });
    await harness.seedMembership(TENANT_A, 3, 1, { validUntil: '2000-01-01T00:00:00Z' });
    // Member 4 has an effective grant but its membership only starts in the far future.
    await harness.seedMembership(TENANT_A, 4, 1, { validFrom: '2999-01-01T00:00:00Z' });
    await harness.seedGrants(TENANT_A, [
      { n: 1, member: 1, role: 1, kind: 'UNIT_SUBTREE', refs: [unitId(2)] },
      { n: 2, member: 1, role: 2, kind: 'TENANT' },
      { n: 3, member: 1, role: 1, kind: 'UNIT_ONLY', refs: [unitId(3)], status: 'Revoked' },
      { n: 4, member: 2, role: 1, kind: 'TENANT' },
      { n: 5, member: 3, role: 1, kind: 'TENANT' },
      { n: 6, member: 4, role: 1, kind: 'TENANT' },
    ]);
    // Tenant B has a membership with the same ordinal and its own grant.
    await harness.seedMembership(TENANT_B, 1, 1);
    await harness.seedGrants(TENANT_B, [{ n: 1, member: 1, role: 2, kind: 'TENANT' }]);
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  beforeEach(() => {
    clock = 1_000_000;
    cache = new InMemoryAuthzCache(() => clock);
    spy = new SpyDatabase(harness.tenants);
    increments.length = 0;
    store = new EffectiveAccessStore(spy as unknown as TenantDatabase, cache, {
      metrics: { increment: (name) => void increments.push(name), gauge: () => undefined },
    });
  });

  it('loads the active grants with role data, scope paths and the database scope_version', async () => {
    const access = await store.load(contextFor(TENANT_A, memberId(1)));
    expect(access.membershipId).toBe(memberId(1));
    expect(access.scopeVersion).toBe(1);
    expect(access.membershipActive).toBe(true);
    expect(access.grants.map((grant) => grant.roleCode).sort()).toEqual(['MEMBER', 'UNIT_ADMIN']);
    const subtree = access.grants.find((grant) => grant.roleCode === 'UNIT_ADMIN');
    expect(subtree).toMatchObject({
      rank: 70,
      permissions: ['iam.unit.manage', 'iam.member.*'],
      scope: { kind: 'UNIT_SUBTREE', refIds: [unitId(2)], paths: ['/u1/u2/'] },
      status: 'Active',
    });
    expect(subtree?.effectiveFrom).toBeInstanceOf(Date);
    expect(subtree?.effectiveUntil).toBeNull();
    expect(access.grants.find((grant) => grant.roleCode === 'MEMBER')?.scope).toEqual({ kind: 'TENANT' });
  });

  it('does not return a revoked grant', async () => {
    const access = await store.load(contextFor(TENANT_A, memberId(1)));
    expect(access.grants.some((grant) => grant.scope.kind === 'UNIT_ONLY')).toBe(false);
  });

  it('marks a Suspended membership and a membership past valid_until as not active', async () => {
    expect((await store.load(contextFor(TENANT_A, memberId(2)))).membershipActive).toBe(false);
    expect((await store.load(contextFor(TENANT_A, memberId(3)))).membershipActive).toBe(false);
  });

  it('does not activate a membership before its valid_from, although its grants are already effective', async () => {
    const access = await store.load(contextFor(TENANT_A, memberId(4)));
    expect(access.membershipActive).toBe(false);
    expect(access.grants).toHaveLength(1);
    // A membership that started when it was created (valid_from defaults to now) is active.
    expect((await store.load(contextFor(TENANT_A, memberId(1)))).membershipActive).toBe(true);
  });

  it('answers an unknown membership with an inactive empty access and caches nothing for it', async () => {
    const access = await store.load(contextFor(TENANT_A, memberId(99)));
    expect(access).toEqual({ membershipId: memberId(99), scopeVersion: 0, membershipActive: false, grants: [] });
    expect(await cache.get(TENANT_A, memberId(99), 0)).toBeUndefined();
  });

  it('serves the second load from the cache without reading grants again', async () => {
    const ctx = contextFor(TENANT_A, memberId(1));
    const first = await store.load(ctx);
    expect(spy.grantReads()).toBe(1);
    const second = await store.load(ctx);
    expect(spy.grantReads()).toBe(1);
    expect(second).toEqual(first);
    expect(increments).toEqual(['authz_cache_miss_total', 'authz_cache_hit_total']);
  });

  it('reads the database again once scope_version moved, even before the TTL ends', async () => {
    const ctx = contextFor(TENANT_A, memberId(1));
    await store.load(ctx);
    await harness.owner(TENANT_A, [['update machvon.membership set scope_version = scope_version + 1 where id = $1', [memberId(1)]]]);
    const reloaded = await store.load(ctx);
    expect(spy.grantReads()).toBe(2);
    expect(reloaded.scopeVersion).toBe(2);
    await harness.owner(TENANT_A, [['update machvon.membership set scope_version = 1 where id = $1', [memberId(1)]]]);
  });

  it('reads the database again after the 60 second TTL', async () => {
    const ctx = contextFor(TENANT_A, memberId(1));
    await store.load(ctx);
    clock += 60_000;
    await store.load(ctx);
    expect(spy.grantReads()).toBe(2);
  });

  it('applies a custom TTL', async () => {
    const short = new EffectiveAccessStore(spy as unknown as TenantDatabase, cache, { ttlSeconds: 5 });
    const ctx = contextFor(TENANT_A, memberId(1));
    await short.load(ctx);
    clock += 5_000;
    await short.load(ctx);
    expect(spy.grantReads()).toBe(2);
  });

  it('reports the current scope_version, and 0 for an unknown membership', async () => {
    expect(await store.currentScopeVersion(contextFor(TENANT_A, memberId(1)))).toBe(1);
    expect(await store.currentScopeVersion(contextFor(TENANT_A, memberId(99)))).toBe(0);
  });

  it('drops only the listed memberships on iam.access.changed.v1', async () => {
    await store.load(contextFor(TENANT_A, memberId(1)));
    await store.load(contextFor(TENANT_A, memberId(2)));
    await store.onAccessChanged({ tenantId: TENANT_A, membershipIds: [memberId(1)] });
    expect(await cache.get(TENANT_A, memberId(1), 1)).toBeUndefined();
    expect(await cache.get(TENANT_A, memberId(2), 1)).toBeDefined();
  });

  it('never loads another tenant’s grants for the same membership ordinal', async () => {
    const a = await store.load(contextFor(TENANT_A, memberId(1)));
    const b = await store.load(contextFor(TENANT_B, memberId(1)));
    expect(b.grants.map((grant) => grant.roleCode)).toEqual(['MEMBER']);
    expect(a.grants.length).toBe(2);
    expect(grantId(1)).toBeDefined();
  });
});
