import { STANDARD_FEATURES, entitlementsHash } from '@machvon/kernel';
import type { FeatureEntry, TenantContext } from '@machvon/kernel';
import { Client } from 'pg';
import { InMemoryEntitlementCache } from '../src/entitlement-cache';
import { EntitlementStore } from '../src/entitlement-store';
import { TenantDatabase } from '../src/tenant-database';
import type { TenantTx } from '../src/tenant-database';
import { AuthzHarness, ACTOR, TENANT_A, TENANT_B, contextFor, memberId } from './support/authz-fixtures';

const PLAN = '00000000-0000-4000-9000-000000000001';
const CTX_A: TenantContext = contextFor(TENANT_A, memberId(1));
const CTX_B: TenantContext = contextFor(TENANT_B, memberId(1));
const SEATS: FeatureEntry = { featureCode: 'member.seats', limitKind: 'QUOTA', limitValue: 50, graceBehavior: 'READ_ONLY', expiredBehavior: 'DENY' };

/** Counts how many tenant transactions the store opened, which is how a cache hit shows. */
class CountingDatabase extends TenantDatabase {
  transactions = 0;

  override withTenant<T>(ctx: TenantContext, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return super.withTenant(ctx, work);
  }
}

describe('entitlements in the database', () => {
  const harness = new AuthzHarness();
  let database: CountingDatabase;
  let clock = Date.parse('2026-10-23T00:00:00Z');
  const cache = new InMemoryEntitlementCache(() => clock);
  let store: EntitlementStore;

  async function admin<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
    const client = new Client({ connectionString: harness.database.adminUrl });
    await client.connect();
    try {
      await client.query('begin');
      // Superuser seeding of rows whose foreign keys point at control-plane data the test does not need.
      await client.query("set local session_replication_role = 'replica'");
      const { rows } = await client.query<T>(text, params);
      await client.query('commit');
      return rows;
    } finally {
      await client.end();
    }
  }

  const recordStandard = (tenantId: string, extra: readonly FeatureEntry[] = []): Promise<{ versionNo: number; hash: string }> =>
    harness.tenants.withTenant(contextFor(tenantId, memberId(1)), (tx) =>
      store.record(tx, { cause: 'PROVISIONING', planVersionId: PLAN, features: [...STANDARD_FEATURES, ...extra] }),
    );

  beforeAll(async () => {
    await harness.start();
    database = new CountingDatabase(harness.appPool);
    store = new EntitlementStore(database, cache, { ttlSeconds: 60, now: () => new Date(clock) });
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  it('seeds one Published STANDARD plan whose rows are the STANDARD defaults plus the seat quota', async () => {
    const plans = await admin<{ id: string; status: string; revision: number }>("select id, status, revision from machvon.product_plan_version where plan_code = 'STANDARD'");
    expect(plans).toEqual([{ id: PLAN, status: 'Published', revision: 1 }]);
    const rows = await admin<{ feature_code: string; limit_kind: string; limit_value: string | null; grace_behavior: string; expired_behavior: string }>(
      'select feature_code, limit_kind, limit_value, grace_behavior, expired_behavior from machvon.plan_feature where plan_version_id = $1 order by feature_code',
      [PLAN],
    );
    const fromDatabase = rows.map((row) => ({
      featureCode: row.feature_code,
      limitKind: row.limit_kind,
      ...(row.limit_value === null ? {} : { limitValue: Number(row.limit_value) }),
      graceBehavior: row.grace_behavior,
      expiredBehavior: row.expired_behavior,
    }));
    const expected = [...STANDARD_FEATURES, SEATS].sort((a, b) => (a.featureCode < b.featureCode ? -1 : 1));
    expect(fromDatabase).toEqual(expected);
  });

  it('shows no entitlement for a tenant that has none, so every gated feature is off', async () => {
    const snapshot = await store.current(CTX_A);
    expect(snapshot).toMatchObject({ versionNo: 0, features: [], overrides: [], licenseMode: 'FULL', tenantPolicy: 'FULL' });
    expect(await store.allowed(CTX_A, 'reporting', 'read')).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
  });

  it('records versions one after the other with the hash of the features and the change event in the same transaction', async () => {
    const first = await recordStandard(TENANT_A);
    expect(first).toEqual({ versionNo: 1, hash: entitlementsHash(STANDARD_FEATURES) });
    const second = await recordStandard(TENANT_A, [SEATS]);
    expect(second).toEqual({ versionNo: 2, hash: entitlementsHash([...STANDARD_FEATURES, SEATS]) });
    const events = await harness.owner<{ payload: { tenant_id: string; version_no: number; entitlements_hash: string }; type: string; event_key: string }>(TENANT_A, [
      ["select payload, type, event_key from machvon.outbox_event where type = 'sas.entitlement.changed.v1' order by (payload->>'version_no')::int", []],
    ]);
    expect(events.map((event) => event.payload)).toEqual([
      { tenant_id: TENANT_A, version_no: 1, entitlements_hash: first.hash },
      { tenant_id: TENANT_A, version_no: 2, entitlements_hash: second.hash },
    ]);
    expect(events.map((event) => event.event_key)).toEqual([`entitlement:${TENANT_A}:1`, `entitlement:${TENANT_A}:2`]);
  });

  it('writes neither the version nor the event when the transaction rolls back', async () => {
    await expect(
      harness.tenants.withTenant(CTX_B, async (tx) => {
        await store.record(tx, { cause: 'PROVISIONING', planVersionId: PLAN, features: STANDARD_FEATURES });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    const rows = await harness.owner<{ n: string }>(TENANT_B, [
      ['select (select count(*) from machvon.entitlement_version) + (select count(*) from machvon.outbox_event where type = $1) as n', ['sas.entitlement.changed.v1']],
    ]);
    expect(rows[0]?.n).toBe('0');
  });

  it('numbers concurrent records without a gap or a duplicate', async () => {
    await Promise.all(Array.from({ length: 4 }, () => recordStandard(TENANT_B)));
    const rows = await harness.owner<{ version_no: string }>(TENANT_B, [['select version_no from machvon.entitlement_version order by version_no', []]]);
    expect(rows.map((row) => row.version_no)).toEqual(['1', '2', '3', '4']);
  });

  it.each(['machvon_app', 'machvon_control'] as const)('refuses UPDATE and DELETE of an entitlement version to %s', async (role) => {
    const client = new Client({ connectionString: harness.database.urlFor(role) });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [TENANT_A]);
      await expect(client.query("update machvon.entitlement_version set cause = 'EXPIRY'")).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback');
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [TENANT_A]);
      await expect(client.query('delete from machvon.entitlement_version')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.end();
    }
  });

  it('decides on the plan: reporting and export are on, the three premium features are off', async () => {
    cache.clear();
    expect(await store.allowed(CTX_A, 'reporting', 'write')).toEqual({ allowed: true });
    expect(await store.allowed(CTX_A, 'export', 'export')).toEqual({ allowed: true });
    for (const feature of ['ai.analysis', 'notification.campaign', 'member.invite']) {
      expect(await store.allowed(CTX_A, feature, 'write')).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
    }
  });

  it('serves the second read from the cache and expires the entry after the time to live', async () => {
    cache.clear();
    database.transactions = 0;
    await store.current(CTX_A);
    await store.current(CTX_A);
    expect(database.transactions).toBe(1);
    clock += 59_000;
    await store.current(CTX_A);
    expect(database.transactions).toBe(1);
    clock += 2_000;
    await store.current(CTX_A);
    expect(database.transactions).toBe(2);
  });

  it('lets a risky decision read the database while the cache still holds the old answer', async () => {
    cache.clear();
    expect(await store.allowed(CTX_A, 'member.invite', 'write')).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
    await harness.owner(TENANT_A, [
      [
        `insert into machvon.entitlement_override (tenant_id, id, feature_code, enabled, reason, valid_from, valid_until, status, requested_by, approved_by)
         values ($1, '00000000-0000-4000-a000-000000000001', 'member.invite', true, 'pilot with the agency', now() - interval '1 day', now() + interval '30 days', 'Active', $2, $3)`,
        [TENANT_A, ACTOR, memberId(9)],
      ],
    ]);
    // The cached snapshot is stale until its time to live passes or it is cleared...
    expect(await store.allowed(CTX_A, 'member.invite', 'write')).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
    // ...but a command that must not run on stale data asks the database.
    expect(await store.allowedFromDatabase(CTX_A, 'member.invite', 'write')).toEqual({ allowed: true });
    await cache.invalidate(TENANT_A);
    expect(await store.allowed(CTX_A, 'member.invite', 'write')).toEqual({ allowed: true });
  });

  it('keeps every cache key under its own tenant and clears one tenant without touching the other', async () => {
    cache.clear();
    await store.current(CTX_A);
    await store.current(CTX_B);
    const keys = cache.keys();
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key.startsWith('t:'))).toBe(true);
    expect(keys.some((key) => key.includes(TENANT_A))).toBe(true);
    const before = await cache.get(TENANT_B);
    await cache.invalidate(TENANT_A);
    expect(cache.keys()).toHaveLength(1);
    expect(await cache.get(TENANT_B)).toBe(before);
  });

  it('reads the license status and the tenant state of the tenant itself', async () => {
    await admin(
      "insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status) values ('00000000-0000-4000-8000-0000000000b1', 'POOL', 'vn-north', 'pool-1', 'kms-1', 'Active') on conflict do nothing",
    );
    await admin(
      "insert into machvon.tenant (id, code, name, status, placement_id, region) values ($1, 'tenant-a', 'Tenant A', 'Suspended', '00000000-0000-4000-8000-0000000000b1', 'vn-north') on conflict do nothing",
      [TENANT_A],
    );
    cache.clear();
    expect((await store.current(CTX_A)).tenantPolicy).toBe('READ_ONLY_EXPORT');
    expect(await store.allowed(CTX_A, 'reporting', 'read')).toEqual({ allowed: true });
    expect(await store.allowed(CTX_A, 'reporting', 'write')).toEqual({ allowed: false, reason: 'TENANT_POLICY' });

    await admin(
      `insert into machvon.license_revision (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, signed_claims, key_id)
       select $1, '00000000-0000-4000-b000-000000000001', 'L-1', 1, id, now() - interval '40 days', now() - interval '10 days', now() + interval '5 days', 'Grace', 'claims', 'key-1'
       from machvon.entitlement_version where tenant_id = $1 and version_no = 1`,
      [TENANT_A],
    );
    await admin("update machvon.tenant set status = 'Active' where id = $1", [TENANT_A]);
    cache.clear();
    const snapshot = await store.current(CTX_A);
    expect(snapshot).toMatchObject({ licenseMode: 'GRACE', tenantPolicy: 'FULL' });
    // GRACE follows the plan row: reporting ALLOW, a feature whose grace behaviour is DENY stays off.
    expect(await store.allowed(CTX_A, 'reporting', 'write')).toEqual({ allowed: true });
  });

  it('refuses a malformed stored feature list instead of guessing', async () => {
    await admin(
      `insert into machvon.entitlement_version (tenant_id, id, version_no, plan_version_id, features_json, entitlements_hash, cause, effective_from)
       values ($1, '00000000-0000-4000-c000-000000000001', 5, $2, '{"not":"a list"}', repeat('0', 64), 'OVERRIDE', now())`,
      [TENANT_B, PLAN],
    );
    cache.clear();
    await expect(store.current(CTX_B)).rejects.toThrow('entitlement features');
  });
});
