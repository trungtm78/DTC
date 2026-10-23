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
  const BASE = Date.parse('2026-10-23T00:00:00Z');
  let clock = BASE;
  // Fixture dates are measured from the clock of the store, never from the wall clock of the machine that runs the suite.
  const at = (days: number): string => new Date(BASE + days * 86_400_000).toISOString();
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

  it('records versions one after the other with the hash of the features and the change event in the same transaction (AC-ST-SAS-002-1)', async () => {
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

  it('names the latest version of a tenant by its id, and nothing for a tenant without a version', async () => {
    const latest = (tenantId: string): Promise<string | undefined> => harness.tenants.withTenant(contextFor(tenantId, memberId(1)), (tx) => store.latestVersionId(tx));
    // Tenant B has no version yet at this point; tenant A got two in the test before.
    expect(await latest(TENANT_B)).toBeUndefined();
    const rows = await admin<{ id: string }>('select id from machvon.entitlement_version where tenant_id = $1 order by version_no desc limit 1', [TENANT_A]);
    expect(rows).toHaveLength(1);
    expect(await latest(TENANT_A)).toBe(rows[0]?.id);
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
         values ($1, '00000000-0000-4000-a000-000000000001', 'member.invite', true, 'pilot with the agency', $4::timestamptz, $5::timestamptz, 'Active', $2, $3)`,
        [TENANT_A, ACTOR, memberId(9), at(-1), at(30)],
      ],
    ]);
    // The cached snapshot is stale until its time to live passes or it is cleared...
    expect(await store.allowed(CTX_A, 'member.invite', 'write')).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
    // ...but a command that must not run on stale data asks the database.
    expect(await store.allowedFromDatabase(CTX_A, 'member.invite', 'write')).toEqual({ allowed: true });
    await cache.invalidate(TENANT_A);
    expect(await store.allowed(CTX_A, 'member.invite', 'write')).toEqual({ allowed: true });
  });

  it('keeps every cache key under its own tenant and clears one tenant without touching the other (AC-ST-SAS-002-2)', async () => {
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
       select $1, '00000000-0000-4000-b000-000000000001', 'L-1', 1, id, $2::timestamptz, $3::timestamptz, $4::timestamptz, 'Grace', 'claims', 'key-1'
       from machvon.entitlement_version where tenant_id = $1 and version_no = 1`,
      [TENANT_A, at(-40), at(-10), at(5)],
    );
    await admin("update machvon.tenant set status = 'Active' where id = $1", [TENANT_A]);
    cache.clear();
    const snapshot = await store.current(CTX_A);
    expect(snapshot).toMatchObject({ licenseMode: 'GRACE', tenantPolicy: 'FULL' });
    // GRACE follows the plan row: reporting ALLOW, a feature whose grace behaviour is DENY stays off.
    expect(await store.allowed(CTX_A, 'reporting', 'write')).toEqual({ allowed: true });
  });

  it('judges the license in force now: a renewal that starts later changes nothing yet', async () => {
    // Tenant A holds revision 1 (Grace, in force by its dates, see the test above); revision 2 is issued for the future.
    await admin(
      `insert into machvon.license_revision (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, signed_claims, key_id)
       select $1, '00000000-0000-4000-b000-000000000002', 'L-2', 2, id, $2::timestamptz, $3::timestamptz, $4::timestamptz, 'Issued', 'claims', 'key-1'
       from machvon.entitlement_version where tenant_id = $1 and version_no = 1`,
      [TENANT_A, at(5), at(400), at(430)],
    );
    cache.clear();
    expect((await store.current(CTX_A)).licenseMode).toBe('GRACE');
  });

  it('treats a tenant whose only license starts in the future as not licensed yet, never as FULL', async () => {
    const tenantC = '00000000-0000-4000-8000-00000000000c';
    await admin(
      `insert into machvon.license_revision (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, signed_claims, key_id)
       values ($1, '00000000-0000-4000-b000-000000000003', 'L-C', 1, gen_random_uuid(), $2::timestamptz, $3::timestamptz, $4::timestamptz, 'Issued', 'claims', 'key-1')`,
      [tenantC, at(10), at(400), at(430)],
    );
    cache.clear();
    expect((await store.current(contextFor(tenantC, memberId(1)))).licenseMode).toBe('EXPIRED');
  });

  it('judges a license by the clock, not by the label the status job may not have stored yet: dates in the past are Expired, a revoked license is REVOKED', async () => {
    await admin(
      `insert into machvon.license_revision (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, signed_claims, key_id)
       values ($1, '00000000-0000-4000-b000-000000000004', 'L-B', 1, gen_random_uuid(), $2::timestamptz, $3::timestamptz, $4::timestamptz, 'Active', 'claims', 'key-1')`,
      [TENANT_B, at(-400), at(-100), at(-70)],
    );
    cache.clear();
    expect((await store.current(CTX_B)).licenseMode).toBe('EXPIRED');
    await admin("update machvon.license_revision set status = 'Revoked', status_reason = 'The contract was terminated by the agency.' where tenant_id = $1", [TENANT_B]);
    cache.clear();
    expect((await store.current(CTX_B)).licenseMode).toBe('REVOKED');
    await admin('delete from machvon.license_revision where tenant_id = $1', [TENANT_B]);
  });

  describe('which license is in force when a tenant has several serials', () => {
    // Every first revision is 1, so the revision number cannot tell serials apart: the dates and the labels have to.
    let n = 0;
    async function tenantWith(licenses: Array<{ serial: string; status: string; from: number; until: number; grace: number }>): Promise<TenantContext> {
      n += 1;
      const tenantId = `00000000-0000-4000-8000-0000000d${n.toString(16).padStart(4, '0')}`;
      for (const license of licenses) {
        await admin(
          `insert into machvon.license_revision (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, signed_claims, key_id, status_reason)
           values ($1, gen_random_uuid(), $2, 1, gen_random_uuid(), $3::timestamptz, $4::timestamptz, $5::timestamptz, $6, 'claims', 'key-1', $7)`,
          [tenantId, license.serial, at(license.from), at(license.until), at(license.grace), license.status, license.status === 'Revoked' ? 'The contract was terminated by the agency.' : null],
        );
      }
      return contextFor(tenantId, memberId(1));
    }
    const modeOf = async (ctx: TenantContext): Promise<string> => {
      cache.clear();
      return (await store.current(ctx)).licenseMode;
    };

    it('follows the license issued after a revocation, not the revoked one that also has started', async () => {
      const ctx = await tenantWith([
        { serial: 'LIC-A', status: 'Revoked', from: -100, until: 200, grace: 230 },
        { serial: 'LIC-B', status: 'Issued', from: -2, until: 300, grace: 330 },
      ]);
      expect(await modeOf(ctx)).toBe('FULL');
      const reversed = await tenantWith([
        { serial: 'LIC-B', status: 'Issued', from: -2, until: 300, grace: 330 },
        { serial: 'LIC-A', status: 'Revoked', from: -100, until: 200, grace: 230 },
      ]);
      expect(await modeOf(reversed)).toBe('FULL');
    });

    it('follows the next license at the boundary of two consecutive licenses', async () => {
      const ctx = await tenantWith([
        { serial: 'LIC-A', status: 'Active', from: -400, until: -40, grace: -10 },
        { serial: 'LIC-B', status: 'Issued', from: -40, until: 300, grace: 330 },
      ]);
      expect(await modeOf(ctx)).toBe('FULL');
    });

    it('keeps the revocation of the latest license when only an older license has ended', async () => {
      const ctx = await tenantWith([
        { serial: 'LIC-A', status: 'Active', from: -400, until: -100, grace: -70 },
        { serial: 'LIC-B', status: 'Revoked', from: -60, until: 300, grace: 330 },
      ]);
      expect(await modeOf(ctx)).toBe('REVOKED');
    });

    it('judges the license by the injected clock, not by the clock of the database', async () => {
      const ctx = await tenantWith([{ serial: 'LIC-A', status: 'Issued', from: -10, until: 20, grace: 50 }]);
      expect(await modeOf(ctx)).toBe('FULL');
      clock = BASE + 30 * 86_400_000;
      expect(await modeOf(ctx)).toBe('GRACE');
      clock = BASE + 60 * 86_400_000;
      expect(await modeOf(ctx)).toBe('EXPIRED');
      clock = BASE;
    });
  });

  it('names the id of the version in the same snapshot as its number', async () => {
    const { snapshot, latest } = await harness.tenants.withTenant(CTX_A, async (tx) => ({ snapshot: await store.currentIn(tx, TENANT_A), latest: await store.latestVersionId(tx) }));
    expect(snapshot.versionNo).toBeGreaterThan(0);
    expect(snapshot.versionId).toBe(latest);
    const bare = await harness.tenants.withTenant(contextFor('00000000-0000-4000-8000-0000000ffff1', memberId(1)), (tx) => store.currentIn(tx, '00000000-0000-4000-8000-0000000ffff1'));
    expect(bare.versionNo).toBe(0);
    expect(bare.versionId).toBeUndefined();
  });

  it('copies the version a concurrent recording leaves behind instead of undoing it', async () => {
    const extra: FeatureEntry = { featureCode: 'custom.copy', limitKind: 'BOOLEAN', graceBehavior: 'ALLOW', expiredBehavior: 'DENY' };
    const before = (await harness.tenants.withTenant(CTX_A, (tx) => store.currentIn(tx, TENANT_A))).versionNo;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let entered: () => void = () => undefined;
    const holding = new Promise<void>((resolveEntered) => {
      entered = resolveEntered;
    });
    const recording = harness.tenants.withTenant(CTX_A, async (tx) => {
      await store.record(tx, { cause: 'OVERRIDE', planVersionId: PLAN, features: [...STANDARD_FEATURES, extra] });
      entered();
      await gate;
    });
    await holding;
    const copying = harness.tenants.withTenant(CTX_A, (tx) => store.recordCurrent(tx, 'LICENSE_CHANGE'));
    // The copy has to wait for the recording above; give it the chance to (wrongly) read the version before that one commits.
    const early = await Promise.race([copying.then(() => 'finished'), new Promise<string>((resolveWait) => setTimeout(() => resolveWait('waiting'), 700))]);
    expect(early).toBe('waiting');
    release();
    await Promise.all([recording, copying]);
    cache.clear();
    const after = await store.current(CTX_A);
    expect(after.versionNo).toBe(before + 2);
    expect(after.features.map((feature) => feature.featureCode)).toContain('custom.copy');
  });

  it('records a new version with the features of the latest one and tells the sessions through the entitlement event', async () => {
    const previous = await store.current(CTX_A);
    const before = previous.versionNo;
    const recorded = await harness.tenants.withTenant(CTX_A, (tx) => store.recordCurrent(tx, 'LICENSE_CHANGE'));
    expect(recorded.versionNo).toBe(before + 1);
    cache.clear();
    const after = await store.current(CTX_A);
    expect(after.versionNo).toBe(before + 1);
    expect(after.features).toEqual(previous.features);
    expect(after.hash).toBe(previous.hash);
    const events = await admin<{ payload: { version_no: number } }>("select payload from machvon.outbox_event where tenant_id = $1 and type = 'sas.entitlement.changed.v1' and (payload->>'version_no')::int = $2", [TENANT_A, before + 1]);
    expect(events).toHaveLength(1);
    const cause = await admin<{ cause: string }>('select cause from machvon.entitlement_version where tenant_id = $1 and version_no = $2', [TENANT_A, before + 1]);
    expect(cause[0]?.cause).toBe('LICENSE_CHANGE');
  });

  it('has nothing to record for a tenant without any entitlement version', async () => {
    const empty = contextFor('00000000-0000-4000-8000-0000000000ee', memberId(1));
    await expect(harness.tenants.withTenant(empty, (tx) => store.recordCurrent(tx, 'LICENSE_CHANGE'))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
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
