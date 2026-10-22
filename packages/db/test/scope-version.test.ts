import { effectivePermissions, scopeContains } from '@machvon/kernel';
import type { EffectiveAccess, ResourceRef } from '@machvon/kernel';
import { bumpScopeVersion, membershipsAffectedByUnits, scopePredicate } from '../src/scope-version';
import { AuthzHarness, TENANT_A, TENANT_B, memberId, roleId, unitId } from './support/authz-fixtures';

const NOW = new Date('2026-06-01T00:00:00Z');

// Tree: /a/ (1) > /a/1/ (2) > /a/1/x/ (3); /a/12/ (4) is a sibling whose path starts with the text of /a/1/; /b/ (5) is another root.
const UNITS = [
  { n: 1, path: '/a/' },
  { n: 2, path: '/a/1/', parent: 1 },
  { n: 3, path: '/a/1/x/', parent: 2 },
  { n: 4, path: '/a/12/', parent: 1 },
  { n: 5, path: '/b/' },
];

interface UnitRow {
  id: string;
  path: string;
}

function accessWith(...grants: EffectiveAccess['grants'][number][]): EffectiveAccess {
  return { membershipId: memberId(1), scopeVersion: 1, membershipActive: true, grants };
}

function grantOf(scope: EffectiveAccess['grants'][number]['scope'], permissions: readonly string[]): EffectiveAccess['grants'][number] {
  return { roleCode: 'R', rank: 10, permissions, scope, status: 'Active', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveUntil: null };
}

describe('scope_version and scope predicates', () => {
  const harness = new AuthzHarness();

  const versionOf = async (tenant: string, member: number): Promise<number> => {
    const [row] = await harness.owner<{ v: string }>(tenant, [['select scope_version::text as v from machvon.membership where id = $1', [memberId(member)]]]);
    return Number(row?.v);
  };

  beforeAll(async () => {
    await harness.start();
    for (const tenant of [TENANT_A, TENANT_B]) {
      await harness.seedUnits(tenant, UNITS);
      await harness.seedRole(tenant, 1, 'ROLE_ONE', ['iam.unit.manage'], 70);
      for (const n of [1, 2, 3, 4, 5, 6]) await harness.seedMembership(tenant, n, 1);
    }
    // Member 1: subtree on /a/1/. Member 2: subtree on /a/ (ancestor). Member 3: subtree on /a/12/ (sibling, unaffected by a move of /a/1/).
    // Member 4: UNIT_ONLY on /a/1/x/. Member 5: TENANT. Member 6: subtree on /b/ (other root); also a revoked subtree on /a/ (ignored).
    await harness.seedGrants(TENANT_A, [
      { n: 1, member: 1, role: 1, kind: 'UNIT_SUBTREE', refs: [unitId(2)] },
      { n: 2, member: 2, role: 1, kind: 'UNIT_SUBTREE', refs: [unitId(1)] },
      { n: 3, member: 3, role: 1, kind: 'UNIT_SUBTREE', refs: [unitId(4)] },
      { n: 4, member: 4, role: 1, kind: 'UNIT_ONLY', refs: [unitId(3)] },
      { n: 5, member: 5, role: 1, kind: 'TENANT' },
      { n: 6, member: 6, role: 1, kind: 'UNIT_SUBTREE', refs: [unitId(5)] },
      { n: 7, member: 6, role: 1, kind: 'UNIT_SUBTREE', refs: [unitId(1)], status: 'Revoked' },
    ]);
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  describe('bumpScopeVersion', () => {
    it('increments each listed membership exactly once and no other', async () => {
      const before = [await versionOf(TENANT_A, 1), await versionOf(TENANT_A, 2), await versionOf(TENANT_A, 3)];
      await harness.tenants.withTenant({ tenantId: TENANT_A, membershipId: memberId(1), scopeVersion: 1 }, (tx) => bumpScopeVersion(tx, [memberId(1), memberId(2), memberId(2)]));
      expect([await versionOf(TENANT_A, 1), await versionOf(TENANT_A, 2), await versionOf(TENANT_A, 3)]).toEqual([before[0]! + 1, before[1]! + 1, before[2]!]);
    });

    it('does nothing for an empty list and cannot reach another tenant’s membership', async () => {
      const ctx = { tenantId: TENANT_A, membershipId: memberId(1), scopeVersion: 1 };
      const otherBefore = await versionOf(TENANT_B, 1);
      await harness.tenants.withTenant(ctx, (tx) => bumpScopeVersion(tx, []));
      await harness.tenants.withTenant(ctx, (tx) => bumpScopeVersion(tx, [memberId(1)]));
      expect(await versionOf(TENANT_B, 1)).toBe(otherBefore);
    });
  });

  describe('membershipsAffectedByUnits', () => {
    const affected = (unitIds: string[]): Promise<string[]> =>
      harness.tenants.withTenant({ tenantId: TENANT_A, membershipId: memberId(1), scopeVersion: 1 }, (tx) => membershipsAffectedByUnits(tx, unitIds));

    it('finds holders of the unit’s own subtree, of an ancestor subtree and of a UNIT_ONLY grant on the unit', async () => {
      const ids = await affected([unitId(2)]);
      expect(ids).toEqual(expect.arrayContaining([memberId(1), memberId(2)]));
      expect(await affected([unitId(3)])).toEqual(expect.arrayContaining([memberId(4), memberId(1), memberId(2)]));
      expect(await affected([unitId(2)])).not.toContain(memberId(4));
    });

    it('also finds a holder whose subtree root lies inside the unit’s subtree (its path changes too)', async () => {
      expect(await affected([unitId(1)])).toEqual(expect.arrayContaining([memberId(1), memberId(2), memberId(3)]));
    });

    it('does not find holders on a sibling whose path merely starts with the same text, a TENANT holder, a revoked grant or another root', async () => {
      const ids = await affected([unitId(2)]);
      expect(ids).not.toContain(memberId(3));
      expect(ids).not.toContain(memberId(4));
      expect(ids).not.toContain(memberId(5));
      expect(ids).not.toContain(memberId(6));
    });

    it('returns a sorted list without duplicates, and an empty list for no units', async () => {
      const ids = await affected([unitId(2), unitId(3)]);
      expect(ids).toEqual([...new Set(ids)].sort());
      expect(await affected([])).toEqual([]);
    });
  });

  describe('scopePredicate', () => {
    const resourceOf = (unit: UnitRow): ResourceRef => ({ ownerUnitId: unit.id, ownerUnitPath: unit.path });
    const unitsFor = (): UnitRow[] => UNITS.map((unit) => ({ id: unitId(unit.n), path: unit.path }));

    async function visibleIds(access: EffectiveAccess, permission: string): Promise<string[]> {
      const predicate = scopePredicate(access, permission, NOW, { unitPath: 'u.path', unitId: 'u.id' });
      const rows = await harness.owner<{ id: string }>(TENANT_A, [[`select u.id from machvon.organization_unit u where ${predicate.sql} order by u.id`, predicate.params]]);
      return rows.map((row) => row.id);
    }

    function expectedIds(access: EffectiveAccess, permission: string): string[] {
      return unitsFor()
        .filter((unit) => {
          const held = effectivePermissions(access, NOW, resourceOf(unit));
          return [...held].some((pattern) => pattern === permission);
        })
        .map((unit) => unit.id)
        .sort();
    }

    it('returns exactly the units that scopeContains allows, whole path segments only (/a/12/ is not under /a/1/)', async () => {
      const access = accessWith(grantOf({ kind: 'UNIT_SUBTREE', refIds: [unitId(2)], paths: ['/a/1/'] }, ['iam.unit.manage']));
      const ids = await visibleIds(access, 'iam.unit.manage');
      expect(ids).toEqual([unitId(2), unitId(3)].sort());
      expect(ids).toEqual(expectedIds(access, 'iam.unit.manage'));
      expect(scopeContains({ kind: 'UNIT_SUBTREE', refIds: [], paths: ['/a/1/'] }, { ownerUnitId: unitId(4), ownerUnitPath: '/a/12/' })).toBe(false);
    });

    it('combines several grants with OR and handles UNIT_ONLY', async () => {
      const access = accessWith(
        grantOf({ kind: 'UNIT_SUBTREE', refIds: [unitId(5)], paths: ['/b/'] }, ['iam.unit.manage']),
        grantOf({ kind: 'UNIT_ONLY', refIds: [unitId(3)] }, ['iam.unit.manage']),
      );
      expect(await visibleIds(access, 'iam.unit.manage')).toEqual([unitId(3), unitId(5)].sort());
    });

    it('matches permission patterns held by the grant', async () => {
      const access = accessWith(grantOf({ kind: 'UNIT_ONLY', refIds: [unitId(4)] }, ['iam.*']));
      expect(await visibleIds(access, 'iam.unit.manage')).toEqual([unitId(4)]);
    });

    it('returns true for a TENANT grant and false when no active grant carries the permission', async () => {
      const tenantWide = scopePredicate(accessWith(grantOf({ kind: 'TENANT' }, ['iam.unit.manage'])), 'iam.unit.manage', NOW, { unitPath: 'u.path', unitId: 'u.id' });
      expect(tenantWide).toEqual({ sql: 'true', params: [] });
      const none = scopePredicate(accessWith(grantOf({ kind: 'TENANT' }, ['audit.read'])), 'iam.unit.manage', NOW, { unitPath: 'u.path', unitId: 'u.id' });
      expect(none).toEqual({ sql: 'false', params: [] });
      expect(await visibleIds(accessWith(), 'iam.unit.manage')).toEqual([]);
    });

    it('ignores expired and not yet started grants and an inactive membership', () => {
      const expired = { ...grantOf({ kind: 'TENANT' }, ['iam.unit.manage']), effectiveUntil: NOW };
      const future = { ...grantOf({ kind: 'TENANT' }, ['iam.unit.manage']), effectiveFrom: new Date(NOW.getTime() + 1) };
      expect(scopePredicate(accessWith(expired, future), 'iam.unit.manage', NOW, { unitPath: 'u.path', unitId: 'u.id' }).sql).toBe('false');
      expect(scopePredicate({ ...accessWith(grantOf({ kind: 'TENANT' }, ['iam.unit.manage'])), membershipActive: false }, 'iam.unit.manage', NOW, { unitPath: 'u.path', unitId: 'u.id' }).sql).toBe('false');
    });

    it('contributes nothing for PROJECT and CONTRACT scopes on a unit-based column', () => {
      const access = accessWith(grantOf({ kind: 'PROJECT', refIds: [roleId(1)] }, ['iam.unit.manage']), grantOf({ kind: 'CONTRACT', refIds: [roleId(2)] }, ['iam.unit.manage']));
      expect(scopePredicate(access, 'iam.unit.manage', NOW, { unitPath: 'u.path', unitId: 'u.id' }).sql).toBe('false');
    });

    it('numbers placeholders from a given first index so it can be appended to other predicates', async () => {
      const access = accessWith(grantOf({ kind: 'UNIT_SUBTREE', refIds: [unitId(2)], paths: ['/a/1/'] }, ['iam.unit.manage']));
      const predicate = scopePredicate(access, 'iam.unit.manage', NOW, { unitPath: 'u.path', unitId: 'u.id' }, 3);
      expect(predicate.sql).toContain('$3');
      expect(predicate.sql).not.toContain('$1');
    });

    it('refuses a column reference that is not a plain identifier', () => {
      const access = accessWith(grantOf({ kind: 'TENANT' }, ['iam.unit.manage']));
      expect(() => scopePredicate(access, 'iam.unit.manage', NOW, { unitPath: 'u.path; drop table x', unitId: 'u.id' })).toThrow();
      expect(() => scopePredicate(access, 'iam.unit.manage', NOW, { unitPath: 'u.path', unitId: "u.id' or '1'='1" })).toThrow();
    });
  });
});
