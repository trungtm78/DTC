import fc from 'fast-check';
import { decide } from '../src/decision';
import { effectivePermissions } from '../src/effective-access';
import type { EffectiveAccess, GrantView } from '../src/effective-access';
import { permissionMatches } from '../src/permission';
import { scopeContains, scopeCovers } from '../src/scope';
import type { Scope } from '../src/scope';

const NOW = new Date('2026-10-23T10:00:00.000Z');

// One coherent pool of units: every id maps to exactly one path, so scopes built from it agree with the tree.
const UNIT_PATHS: Record<string, string> = {
  u1: '/r/u1/',
  u11: '/r/u1/u11/',
  u12: '/r/u1/u12/',
  u111: '/r/u1/u11/u111/',
  u2: '/r/u2/',
  u21: '/r/u2/u21/',
  u10: '/r/u10/',
};
const UNIT_IDS = Object.keys(UNIT_PATHS);
const unitIds = fc.subarray(UNIT_IDS, { minLength: 1 });

const scopes: fc.Arbitrary<Scope> = fc.oneof(
  fc.constant<Scope>({ kind: 'TENANT' }),
  unitIds.map<Scope>((ids) => ({ kind: 'UNIT_SUBTREE', refIds: ids, paths: ids.map((id) => UNIT_PATHS[id] as string) })),
  unitIds.map<Scope>((ids) => ({ kind: 'UNIT_ONLY', refIds: ids, paths: ids.map((id) => UNIT_PATHS[id] as string) })),
  fc.subarray(['p1', 'p2', 'p3'], { minLength: 1 }).map<Scope>((ids) => ({ kind: 'PROJECT', refIds: ids })),
  fc.subarray(['c1', 'c2', 'c3'], { minLength: 1 }).map<Scope>((ids) => ({ kind: 'CONTRACT', refIds: ids })),
);

const PERMISSION_NAMES = ['iam.unit.manage', 'iam.role.grant', 'audit.read', 'review.submit', 'iam.*', 'audit.*'];
const permissionLists = fc.subarray(PERMISSION_NAMES, { minLength: 1 });

const grants: fc.Arbitrary<GrantView> = fc.record({
  roleCode: fc.constantFrom('A', 'B', 'C'),
  rank: fc.integer({ min: 1, max: 99 }),
  permissions: permissionLists,
  scope: scopes,
  status: fc.constantFrom('Active', 'Revoked', 'Expired'),
  effectiveFrom: fc.constant(new Date('2026-01-01T00:00:00.000Z')),
  effectiveUntil: fc.constantFrom<Date | null>(null, new Date('2026-12-01T00:00:00.000Z'), new Date('2026-02-01T00:00:00.000Z')),
});

const accessOf = (list: GrantView[], membershipActive = true): EffectiveAccess => ({
  membershipId: 'm',
  scopeVersion: 1,
  membershipActive,
  grants: list,
});

const resources = fc
  .constantFrom(...UNIT_IDS)
  .map((id) => ({ ownerUnitPath: UNIT_PATHS[id] as string, ownerUnitId: id }));

describe('policy decision point properties', () => {
  it('effective permissions only contain permissions of grants that are active now', () => {
    fc.assert(
      fc.property(fc.array(grants, { maxLength: 6 }), (list) => {
        const held = new Set(list.filter((g) => g.status === 'Active' && (g.effectiveUntil === null || NOW < g.effectiveUntil)).flatMap((g) => [...g.permissions]));
        for (const permission of effectivePermissions(accessOf(list), NOW)) expect(held.has(permission)).toBe(true);
      }),
    );
  });

  it('adding a grant never removes a permission, with or without a resource', () => {
    fc.assert(
      fc.property(fc.array(grants, { maxLength: 5 }), grants, resources, (list, extra, resource) => {
        const before = effectivePermissions(accessOf(list), NOW, resource);
        const after = effectivePermissions(accessOf([...list, extra]), NOW, resource);
        for (const permission of before) expect(after.has(permission)).toBe(true);
      }),
    );
  });

  it('scopeCovers is reflexive', () => {
    fc.assert(fc.property(scopes, (scope) => scopeCovers(scope, scope)));
  });

  it('scopeCovers is transitive', () => {
    fc.assert(
      fc.property(scopes, scopes, scopes, (a, b, c) => {
        fc.pre(scopeCovers(a, b) && scopeCovers(b, c));
        expect(scopeCovers(a, c)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('a covering scope contains every resource that the covered scope contains', () => {
    fc.assert(
      fc.property(scopes, scopes, resources, (outer, inner, resource) => {
        fc.pre(scopeCovers(outer, inner) && scopeContains(inner, resource));
        expect(scopeContains(outer, resource)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('decide never allows when no active grant of the membership holds the permission', () => {
    fc.assert(
      fc.property(fc.array(grants, { maxLength: 6 }), fc.constantFrom(...PERMISSION_NAMES.filter((name) => !name.endsWith('*'))), fc.boolean(), (list, permission, membershipActive) => {
        const decision = decide({
          required: { permission, plane: 'tenant' },
          principal: { audience: 'tenant', assurance: 'aal2', aal2At: NOW, sessionRevoked: false, tokenScopeVersion: 1 },
          access: accessOf(list, membershipActive),
          now: NOW,
        });
        const held = membershipActive && [...effectivePermissions(accessOf(list), NOW)].some((pattern) => permissionMatches(pattern, permission));
        expect(decision.allow).toBe(held);
      }),
      { numRuns: 1000 },
    );
  });
});
