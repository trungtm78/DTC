import { Client } from 'pg';
import { MyAccessStore } from '../src/my-access-store';
import { seedSystemRoles } from '../src/system-roles';
import type { TenantTx } from '../src/tenant-database';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, grantId, id, memberId, unitId } from './support/authz-fixtures';

const ACTOR = memberId(99);
const harness = new AuthzHarness();
const store = new MyAccessStore();
const inTenant = <T>(work: (tx: TenantTx) => Promise<T>, tenant = TENANT_A): Promise<T> => harness.tenants.withTenant(contextFor(tenant, memberId(1)), work);

describe('MyAccessStore (the data of IAM-09)', () => {
  const roles = new Map<string, string>();

  const admin = async <R extends object>(text: string, params: unknown[] = []): Promise<R[]> => {
    const client = new Client({ connectionString: harness.database.adminUrl });
    await client.connect();
    try {
      await client.query('set session_replication_role = replica');
      return (await client.query(text, params)).rows as R[];
    } finally {
      await client.end();
    }
  };

  const grant = (n: number, member: number, code: string, kind: string, refs: string[], status = 'Active'): Promise<unknown> =>
    harness.owner(TENANT_A, [
      [
        `insert into machvon.role_grant (tenant_id, id, membership_id, role_id, scope_json, effective_from, scope_kind, scope_ref_ids, status, granted_by, grant_reason)
         values ($1, $2, $3, $4, jsonb_build_object('kind', $5::text), '2026-01-01T00:00:00Z', $5, $6::uuid[], $7, $8, 'test')`,
        [TENANT_A, grantId(n), memberId(member), roles.get(code), kind, refs, status, ACTOR],
      ],
    ]);

  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [
      { n: 1, path: '/a/' },
      { n: 2, path: '/a/b/', parent: 1 },
      { n: 3, path: '/a/b/c/', parent: 2 },
      { n: 4, path: '/a/d/', parent: 1 },
    ]);
    await harness.seedUnits(TENANT_B, [{ n: 1, path: '/z/' }]);
    for (const member of [1, 2]) await harness.seedMembership(TENANT_A, member, 3);
    await harness.seedMembership(TENANT_B, 1, 1);
    await inTenant((tx) => seedSystemRoles(tx, ACTOR));
    for (const row of await harness.owner<{ id: string; code: string }>(TENANT_A, [['select id, code from machvon.role_definition']])) roles.set(row.code, row.id);
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  it('names a unit scope with its breadcrumb from the root, one entry per unit of a grant that names several', async () => {
    await grant(1, 1, 'UNIT_ADMIN', 'UNIT_SUBTREE', [unitId(3), unitId(4)]);
    const [found] = await inTenant((tx) => store.grants(tx, memberId(1)));
    expect(found?.units.map((unit) => ({ code: unit.code, path: unit.path, crumbs: unit.breadcrumb.map((crumb) => crumb.code) }))).toEqual([
      { code: 'U3', path: '/a/b/c/', crumbs: ['U1', 'U2', 'U3'] },
      { code: 'U4', path: '/a/d/', crumbs: ['U1', 'U4'] },
    ]);
    expect(found).toMatchObject({ scopeKind: 'UNIT_SUBTREE', scopeRefIds: [unitId(3), unitId(4)], storedStatus: 'Active', projects: [], contracts: [] });
    expect(found?.view).toMatchObject({ roleCode: 'UNIT_ADMIN', rank: 70 });
  });

  it('shows grants the expiry job marked Expired and leaves out the revoked ones', async () => {
    await grant(2, 2, 'LEADER', 'TENANT', [], 'Expired');
    await harness.owner(TENANT_A, [
      [
        `insert into machvon.role_grant (tenant_id, id, membership_id, role_id, scope_json, effective_from, scope_kind, scope_ref_ids, status, granted_by, grant_reason, revoked_at)
         values ($1, $2, $3, $4, '{"kind":"TENANT"}'::jsonb, '2026-01-01T00:00:00Z', 'TENANT', '{}', 'Revoked', $5, 'test', now())`,
        [TENANT_A, grantId(3), memberId(2), roles.get('AUDITOR'), ACTOR],
      ],
    ]);
    const found = await inTenant((tx) => store.grants(tx, memberId(2)));
    expect(found.map((row) => [row.view.roleCode, row.storedStatus])).toEqual([['LEADER', 'Expired']]);
  });

  it('skips a scope that names a project or contract that does not exist, and does not loop on a corrupt tree', async () => {
    await grant(4, 1, 'SPECIALIST', 'PROJECT', [id(0x50, 9)]);
    await grant(5, 1, 'GUEST_CONTRACTOR', 'CONTRACT', [id(0x51, 9)]);
    // A cycle the tree rules would refuse: the store still ends and gives what it found.
    await admin('update machvon.organization_unit set parent_id = $2 where tenant_id = $1 and id = $3', [TENANT_A, unitId(3), unitId(1)]);
    try {
      const found = await inTenant((tx) => store.grants(tx, memberId(1)));
      expect(found.find((row) => row.scopeKind === 'PROJECT')).toMatchObject({ projects: [], units: [] });
      expect(found.find((row) => row.scopeKind === 'CONTRACT')).toMatchObject({ contracts: [] });
      expect(found.find((row) => row.scopeKind === 'UNIT_SUBTREE')?.units[0]?.breadcrumb.length).toBeLessThanOrEqual(4);
    } finally {
      await admin('update machvon.organization_unit set parent_id = $2 where tenant_id = $1 and id = $3', [TENANT_A, unitId(2), unitId(3)]);
    }
  });

  it('reads the scope version and nothing else of other members: 0 for a membership that is not in the tenant', async () => {
    expect(await inTenant((tx) => store.scopeVersionOf(tx, memberId(1)))).toBeGreaterThanOrEqual(1);
    expect(await inTenant((tx) => store.scopeVersionOf(tx, memberId(1)), TENANT_B)).toBeGreaterThanOrEqual(1);
    expect(await inTenant((tx) => store.scopeVersionOf(tx, memberId(50)))).toBe(0);
    expect(await inTenant((tx) => store.grants(tx, memberId(1)), TENANT_B)).toEqual([]);
  });

  it('reads the delegations received, defaulting a scope without a kind to the whole tenant', async () => {
    await admin(
      `insert into machvon.delegation_grant (tenant_id, id, delegator_membership_id, delegate_membership_id, permissions, scope_json, valid_from, valid_until, reason, status)
       values ($1, $2, $3, $4, array['approval.decide'], '{}'::jsonb, now() - interval '1 day', now() + interval '3 days', 'cover', 'Active')`,
      [TENANT_A, id(0x55, 1), memberId(2), memberId(1)],
    );
    const found = await inTenant((tx) => store.delegationsTo(tx, memberId(1)));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ delegatorMembershipId: memberId(2), permissions: ['approval.decide'], scopeKind: 'TENANT', scopeRefIds: [], status: 'Active' });
    expect(await inTenant((tx) => store.delegationsTo(tx, memberId(2)))).toEqual([]);
  });
});
