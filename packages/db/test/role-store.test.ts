import { Client } from 'pg';
import { SYSTEM_ROLES, seedSystemRoles } from '../src/system-roles';
import { RoleStore } from '../src/role-store';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, grantId, id, memberId, roleId, unitId } from './support/authz-fixtures';

const store = new RoleStore();
const ACTOR = '00000000-0000-4000-8000-0000000000f0';
const CTX_A = contextFor(TENANT_A, memberId(1));
const CTX_B = contextFor(TENANT_B, memberId(1));
const PROJECT = id(0x50, 1);
const CONTRACT = id(0x51, 1);
const OTHER_PROJECT = id(0x50, 2);

describe('RoleStore', () => {
  const harness = new AuthzHarness();
  const inA = <T>(work: Parameters<typeof harness.tenants.withTenant<T>>[1]): Promise<T> => harness.tenants.withTenant(CTX_A, work);

  async function seedProjectAndContract(): Promise<void> {
    // Foreign keys to unrelated modules are out of scope here, so the superuser seeds with them switched off.
    const client = new Client({ connectionString: harness.database.adminUrl });
    await client.connect();
    try {
      await client.query('set session_replication_role = replica');
      await client.query(
        `insert into machvon.project (tenant_id, id, code, name, owner_unit_id, area_master_version_id, classification, total_investment_vnd, status, version)
         values ($1, $2, 'P1', 'Project 1', $3, $4, 'INTERNAL', 1000, 'CONCEPT', 1), ($1, $5, 'P2', 'Project 2', $6, $4, 'INTERNAL', 1000, 'CONCEPT', 1)`,
        [TENANT_A, PROJECT, unitId(2), id(0x52, 1), OTHER_PROJECT, unitId(3)],
      );
      await client.query(
        `insert into machvon.contract (tenant_id, id, project_id, package_id, contractor_id, code, type, currency, status, version)
         values ($1, $2, $3, $4, $5, 'C1', 'LUMP_SUM', 'VND', 'DRAFT', 1)`,
        [TENANT_A, CONTRACT, PROJECT, id(0x53, 1), id(0x54, 1)],
      );
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await harness.start();
    for (const tenant of [TENANT_A, TENANT_B]) {
      await harness.seedUnits(tenant, [
        { n: 1, path: '/u1/' },
        { n: 2, path: '/u1/u2/', parent: 1 },
        { n: 3, path: '/u1/u3/', parent: 1 },
      ]);
    }
    await harness.tenants.withTenant(CTX_A, (tx) => seedSystemRoles(tx, ACTOR));
    await harness.tenants.withTenant(CTX_B, (tx) => seedSystemRoles(tx, ACTOR));
    await harness.seedMembership(TENANT_A, 1, 1);
    await harness.seedMembership(TENANT_A, 2, 2);
    await harness.seedMembership(TENANT_A, 3, 3, { validUntil: '2000-01-01T00:00:00Z' });
    await harness.seedMembership(TENANT_A, 4, 1);
    await harness.seedMembership(TENANT_B, 1, 1);
    await seedProjectAndContract();
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  const roleByCode = async (tenant: typeof CTX_A, code: string): Promise<string> => {
    const rows = await harness.tenants.withTenant(tenant, (tx) => tx.query<{ id: string }>('select id from machvon.role_definition where code = $1', [code]));
    return rows[0]?.id ?? '';
  };

  describe('custom roles', () => {
    const base = { name: 'Reviewer', permissions: ['report.read'], rank: 40, guestAllowed: false, createdBy: ACTOR };

    it('creates a custom role at version 1 and refuses a duplicate code with 409 ROLE_CODE_TAKEN', async () => {
      const created = await inA((tx) => store.createCustomRole(tx, { ...base, code: 'REVIEWER' }));
      expect(created.version).toBe(1);
      const role = await inA((tx) => store.findRole(tx, created.id));
      expect(role).toMatchObject({ code: 'REVIEWER', rank: 40, isSystem: false, status: 'Active', version: 1, permissions: ['report.read'] });
      await expect(inA((tx) => store.createCustomRole(tx, { ...base, code: 'REVIEWER' }))).rejects.toMatchObject({ code: 'ROLE_CODE_TAKEN', status: 409 });
    });

    it('lets the same code exist in another tenant and hides roles across tenants', async () => {
      const created = await harness.tenants.withTenant(CTX_B, (tx) => store.createCustomRole(tx, { ...base, code: 'REVIEWER' }));
      expect(await inA((tx) => store.findRole(tx, created.id))).toBeUndefined();
    });

    it('lets the database refuse a system permission and a custom rank above 89 even if the API were bypassed', async () => {
      await expect(inA((tx) => store.createCustomRole(tx, { ...base, code: 'BAD_SYSTEM', permissions: ['system.tenant.manage'] }))).rejects.toMatchObject({ code: '23514' });
      await expect(inA((tx) => store.createCustomRole(tx, { ...base, code: 'BAD_RANK', rank: 95 }))).rejects.toMatchObject({ code: '23514' });
    });

    it('locks a custom role for change: unknown is 404, system is 409 SYSTEM_ROLE_IMMUTABLE, stale is 409 VERSION_CONFLICT', async () => {
      const created = await inA((tx) => store.createCustomRole(tx, { ...base, code: 'LOCKED' }));
      await expect(inA((tx) => store.lockCustomRole(tx, roleId(99), 1))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
      const system = await roleByCode(CTX_A, 'TENANT_ADMIN');
      await expect(inA((tx) => store.lockCustomRole(tx, system, 1))).rejects.toMatchObject({ code: 'SYSTEM_ROLE_IMMUTABLE', status: 409 });
      await expect(inA((tx) => store.lockCustomRole(tx, created.id, 7))).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
        extensions: { current_version: 1 },
      });
      expect((await inA((tx) => store.lockCustomRole(tx, created.id, 1))).code).toBe('LOCKED');
    });

    it('updates a role, raises its version and reports every member holding it', async () => {
      const created = await inA((tx) => store.createCustomRole(tx, { ...base, code: 'HELD' }));
      await harness.owner(TENANT_A, [
        [
          `insert into machvon.role_grant (tenant_id, id, membership_id, role_id, scope_json, effective_from, scope_kind, scope_ref_ids, status, granted_by, grant_reason)
           values ($1, $2, $3, $4, '{}'::jsonb, now() - interval '1 day', 'TENANT', '{}', 'Active', $5, 'seed'),
                  ($1, $6, $7, $4, '{}'::jsonb, now() - interval '1 day', 'TENANT', '{}', 'Active', $5, 'seed'),
                  ($1, $8, $9, $4, '{}'::jsonb, now() - interval '1 day', 'TENANT', '{}', 'Active', $5, 'seed')`,
          [TENANT_A, grantId(200), memberId(1), created.id, ACTOR, grantId(201), memberId(2), grantId(202), memberId(3)],
        ],
        ["update machvon.role_grant set status = 'Revoked', revoked_at = now() where id = $1", [grantId(202)]],
      ]);
      const result = await inA(async (tx) => {
        await store.lockCustomRole(tx, created.id, 1);
        return store.updateCustomRole(tx, created.id, { permissions: ['report.read', 'report.export'], rank: 45, name: 'Held v2' });
      });
      expect(result.version).toBe(2);
      expect(result.holderMembershipIds).toEqual([memberId(1), memberId(2)]);
      expect(await inA((tx) => store.findRole(tx, created.id))).toMatchObject({ name: 'Held v2', rank: 45, version: 2, permissions: ['report.read', 'report.export'] });
    });

    it('keeps name and rank when an update does not give them', async () => {
      const created = await inA((tx) => store.createCustomRole(tx, { ...base, code: 'KEEPS' }));
      await inA(async (tx) => {
        await store.lockCustomRole(tx, created.id, 1);
        await store.updateCustomRole(tx, created.id, { permissions: ['report.read'] });
      });
      expect(await inA((tx) => store.findRole(tx, created.id))).toMatchObject({ name: 'Reviewer', rank: 40, version: 2 });
    });
  });

  describe('memberships', () => {
    it('locks an existing membership and flags a lapsed one', async () => {
      expect(await inA((tx) => store.lockMembership(tx, memberId(1)))).toEqual({ id: memberId(1), status: 'Active', membershipType: 'STAFF', lapsed: false });
      expect(await inA((tx) => store.lockMembership(tx, memberId(3)))).toMatchObject({ lapsed: true });
    });

    it('does not see the membership of another tenant and returns the scope version', async () => {
      expect(await harness.tenants.withTenant(CTX_B, (tx) => store.lockMembership(tx, memberId(2)))).toBeUndefined();
      expect(await inA((tx) => store.scopeVersionOf(tx, memberId(1)))).toBe(1);
    });
  });

  describe('resolveScope', () => {
    it('resolves TENANT only without references', async () => {
      expect(await inA((tx) => store.resolveScope(tx, 'TENANT', []))).toEqual({ scope: { kind: 'TENANT' }, paths: [] });
      expect(await inA((tx) => store.resolveScope(tx, 'TENANT', [unitId(1)]))).toBeUndefined();
    });

    it('resolves unit scopes with their paths and rejects unknown, foreign and empty references', async () => {
      const resolved = await inA((tx) => store.resolveScope(tx, 'UNIT_SUBTREE', [unitId(3), unitId(2), unitId(2)]));
      expect(resolved).toEqual({
        scope: { kind: 'UNIT_SUBTREE', refIds: [unitId(2), unitId(3)], paths: ['/u1/u2/', '/u1/u3/'] },
        paths: ['/u1/u2/', '/u1/u3/'],
      });
      expect(await inA((tx) => store.resolveScope(tx, 'UNIT_ONLY', [unitId(77)]))).toBeUndefined();
      expect(await inA((tx) => store.resolveScope(tx, 'UNIT_ONLY', []))).toBeUndefined();
      expect(await harness.tenants.withTenant(CTX_B, (tx) => store.resolveScope(tx, 'UNIT_ONLY', [PROJECT]))).toBeUndefined();
    });

    it('resolves a project and a contract to their owner unit', async () => {
      const project = await inA((tx) => store.resolveScope(tx, 'PROJECT', [PROJECT, OTHER_PROJECT]));
      expect(project?.scope).toEqual({ kind: 'PROJECT', refIds: [PROJECT, OTHER_PROJECT].sort() });
      expect(project?.ownerUnitScope).toEqual({ kind: 'UNIT_ONLY', refIds: [unitId(2), unitId(3)], paths: ['/u1/u2/', '/u1/u3/'] });
      const contract = await inA((tx) => store.resolveScope(tx, 'CONTRACT', [CONTRACT]));
      expect(contract?.ownerUnitScope).toEqual({ kind: 'UNIT_ONLY', refIds: [unitId(2)], paths: ['/u1/u2/'] });
      expect(await inA((tx) => store.resolveScope(tx, 'PROJECT', [id(0x50, 99)]))).toBeUndefined();
      expect(await inA((tx) => store.resolveScope(tx, 'CONTRACT', [PROJECT]))).toBeUndefined();
    });
  });

  describe('grants', () => {
    const grant = (membershipId: string, roleIdValue: string, overrides: Record<string, unknown> = {}) => ({
      membershipId,
      roleId: roleIdValue,
      scopeKind: 'UNIT_SUBTREE' as const,
      scopeRefIds: [unitId(2)],
      paths: ['/u1/u2/'],
      grantedBy: memberId(1),
      reason: 'because of the project',
      ...overrides,
    });

    it('inserts an Active grant with a normalised scope and refuses an equal Active grant with 409 ROLE_GRANT_EXISTS', async () => {
      const specialist = await roleByCode(CTX_A, 'SPECIALIST');
      const created = await inA((tx) => store.insertGrant(tx, grant(memberId(2), specialist, { scopeRefIds: [unitId(3), unitId(2)], paths: ['/u1/u2/', '/u1/u3/'] })));
      const stored = await inA((tx) => store.getGrant(tx, created.id));
      expect(stored).toMatchObject({ roleCode: 'SPECIALIST', status: 'Active', scopeKind: 'UNIT_SUBTREE', scopeRefIds: [unitId(2), unitId(3)], version: 1, grantReason: 'because of the project' });
      const json = await harness.owner<{ scope_json: unknown }>(TENANT_A, [['select scope_json from machvon.role_grant where id = $1', [created.id]]]);
      expect(json[0]?.scope_json).toEqual({ kind: 'UNIT_SUBTREE', ref_ids: [unitId(2), unitId(3)], path_prefixes: ['/u1/u2/', '/u1/u3/'] });
      await expect(
        inA((tx) => store.insertGrant(tx, grant(memberId(2), specialist, { scopeRefIds: [unitId(2), unitId(3)], paths: ['/u1/u2/', '/u1/u3/'] }))),
      ).rejects.toMatchObject({ code: 'ROLE_GRANT_EXISTS', status: 409 });
    });

    it('allows the same role on another scope and again after the first grant was revoked', async () => {
      const leader = await roleByCode(CTX_A, 'LEADER');
      const first = await inA((tx) => store.insertGrant(tx, grant(memberId(4), leader)));
      await inA((tx) => store.insertGrant(tx, grant(memberId(4), leader, { scopeKind: 'UNIT_ONLY' })));
      await inA(async (tx) => store.revokeGrant(tx, await store.lockGrant(tx, first.id, 1), memberId(1), 'no longer needed here'));
      await expect(inA((tx) => store.insertGrant(tx, grant(memberId(4), leader)))).resolves.toMatchObject({ version: 1 });
    });

    it('stores an explicit window and a grant of a TENANT scope without references', async () => {
      const auditor = await roleByCode(CTX_A, 'AUDITOR');
      const created = await inA((tx) =>
        store.insertGrant(tx, grant(memberId(2), auditor, { scopeKind: 'TENANT', scopeRefIds: [], paths: [], effectiveFrom: '2030-01-01T00:00:00Z', effectiveUntil: '2031-01-01T00:00:00Z' })),
      );
      expect(await inA((tx) => store.getGrant(tx, created.id))).toMatchObject({
        scopeKind: 'TENANT',
        scopeRefIds: [],
        effectiveFrom: '2030-01-01T00:00:00.000Z',
        effectiveUntil: '2031-01-01T00:00:00.000Z',
      });
    });

    it('revokes a locked grant, raises its version and records who and why', async () => {
      const billing = await roleByCode(CTX_A, 'BILLING_VIEWER');
      const created = await inA((tx) => store.insertGrant(tx, grant(memberId(2), billing)));
      const revoked = await inA(async (tx) => store.revokeGrant(tx, await store.lockGrant(tx, created.id, 1), memberId(1), 'handed over to someone else'));
      expect(revoked.version).toBe(2);
      const row = await harness.owner<{ status: string; revoked_by: string; revoke_reason: string }>(TENANT_A, [
        ['select status, revoked_by, revoke_reason from machvon.role_grant where id = $1', [created.id]],
      ]);
      expect(row[0]).toEqual({ status: 'Revoked', revoked_by: memberId(1), revoke_reason: 'handed over to someone else' });
    });

    it('refuses to lock a missing grant (404), a stale version (409) and a grant that is not Active (409 STAGE_TRANSITION_DENIED)', async () => {
      const memberRole = await roleByCode(CTX_A, 'MEMBER');
      const created = await inA((tx) => store.insertGrant(tx, grant(memberId(2), memberRole)));
      await expect(inA((tx) => store.lockGrant(tx, grantId(999), 1))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
      await expect(inA((tx) => store.lockGrant(tx, created.id, 3))).rejects.toMatchObject({ code: 'VERSION_CONFLICT', extensions: { current_version: 1 } });
      await inA(async (tx) => store.revokeGrant(tx, await store.lockGrant(tx, created.id, 1), memberId(1), 'first revocation'));
      await expect(inA((tx) => store.lockGrant(tx, created.id, 2))).rejects.toMatchObject({ code: 'STAGE_TRANSITION_DENIED', status: 409 });
    });

    it('reports the highest rank of the Active grants of a member', async () => {
      expect(await inA((tx) => store.highestRankOf(tx, memberId(3)))).toBe(0);
      const specialist = await roleByCode(CTX_A, 'SPECIALIST');
      const leader = await roleByCode(CTX_A, 'LEADER');
      await inA((tx) => store.insertGrant(tx, grant(memberId(3), specialist)));
      const second = await inA((tx) => store.insertGrant(tx, grant(memberId(3), leader)));
      expect(await inA((tx) => store.highestRankOf(tx, memberId(3)))).toBe(60);
      await inA(async (tx) => store.revokeGrant(tx, await store.lockGrant(tx, second.id, 1), memberId(1), 'step down please'));
      expect(await inA((tx) => store.highestRankOf(tx, memberId(3)))).toBe(40);
    });

    it('lists grants in id order with a keyset, optionally for one member, and never across tenants', async () => {
      const everything = await inA((tx) => store.listGrants(tx, { after: undefined, limit: 1000 }));
      const ids = everything.map((row) => row.id);
      expect(ids).toEqual([...ids].sort());
      expect(everything.length).toBeGreaterThan(3);
      const page = await inA((tx) => store.listGrants(tx, { after: ids[1], limit: 2 }));
      expect(page.map((row) => row.id)).toEqual(ids.slice(2, 5));
      const mine = await inA((tx) => store.listGrants(tx, { after: undefined, limit: 1000, membershipId: memberId(4) }));
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((row) => row.membershipId === memberId(4))).toBe(true);
      const other = await harness.tenants.withTenant(CTX_B, (tx) => store.listGrants(tx, { after: undefined, limit: 1000 }));
      expect(other).toEqual([]);
    });
  });

  describe('the last TENANT_OWNER', () => {
    it('refuses to revoke the only Active owner and allows it once a second owner exists', async () => {
      const owner = await roleByCode(CTX_A, 'TENANT_OWNER');
      const first = await inA((tx) =>
        store.insertGrant(tx, { membershipId: memberId(1), roleId: owner, scopeKind: 'TENANT', scopeRefIds: [], paths: [], grantedBy: ACTOR, reason: 'control plane assigned' }),
      );
      await expect(inA(async (tx) => store.revokeGrant(tx, await store.lockGrant(tx, first.id, 1), memberId(2), 'try to remove the owner'))).rejects.toMatchObject({
        code: 'LAST_TENANT_OWNER',
        status: 409,
      });
      const second = await inA((tx) =>
        store.insertGrant(tx, { membershipId: memberId(2), roleId: owner, scopeKind: 'TENANT', scopeRefIds: [], paths: [], grantedBy: ACTOR, reason: 'second owner assigned' }),
      );
      await inA(async (tx) => store.revokeGrant(tx, await store.lockGrant(tx, first.id, 1), memberId(2), 'owner handed over'));
      await expect(inA(async (tx) => store.revokeGrant(tx, await store.lockGrant(tx, second.id, 1), memberId(1), 'remove the remaining owner'))).rejects.toMatchObject({
        code: 'LAST_TENANT_OWNER',
      });
    });

    it('lets exactly one of two concurrent revocations of the two remaining owners through', async () => {
      const owner = await roleByCode(CTX_A, 'TENANT_OWNER');
      const ownerGrants = (
        await inA((tx) => tx.query<{ id: string; version: string }>("select id, version::text as version from machvon.role_grant where role_id = $1 and status = 'Active'", [owner]))
      ).map((row) => row.id);
      // Only member 2 holds the role now; give member 4 the role so two owners are Active.
      const extra = await inA((tx) =>
        store.insertGrant(tx, { membershipId: memberId(4), roleId: owner, scopeKind: 'TENANT', scopeRefIds: [], paths: [], grantedBy: ACTOR, reason: 'third owner assigned' }),
      );
      const targets = [...ownerGrants, extra.id];
      expect(targets).toHaveLength(2);
      const results = await Promise.allSettled(
        targets.map((target) => inA(async (tx) => store.revokeGrant(tx, await store.lockGrant(tx, target, 1), memberId(3), 'concurrent removal'))),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: 'LAST_TENANT_OWNER' });
    });
  });

  it('seeds every system role once for the tenant', async () => {
    const roles = await inA((tx) => tx.query<{ n: string }>('select count(*) as n from machvon.role_definition where is_system'));
    expect(Number(roles[0]?.n)).toBe(SYSTEM_ROLES.length);
  });
});
