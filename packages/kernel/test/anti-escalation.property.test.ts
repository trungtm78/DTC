import fc from 'fast-check';
import { checkGrant, permissionCovered } from '../src/anti-escalation';
import { activeGrants, maxRank } from '../src/effective-access';
import type { EffectiveAccess, GrantView } from '../src/effective-access';
import type { Scope } from '../src/scope';

const NOW = new Date('2026-10-23T03:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');
const TENANT: Scope = { kind: 'TENANT' };
const MEMBERS = ['m0', 'm1', 'm2', 'm3'] as const;

const PERMISSIONS = [
  'iam.role.grant',
  'iam.unit.manage',
  'iam.member.read',
  'iam.*',
  'iam.member.*',
  'adm.*',
  'adm.workflow.manage',
  'audit.read',
  'payment.approve',
  'payment.*',
  'system.tenant.manage',
  '*',
];

const permissionList = fc.uniqueArray(fc.constantFrom(...PERMISSIONS), { minLength: 1, maxLength: 5 });
const role = fc.record({ rank: fc.integer({ min: 1, max: 99 }), permissions: permissionList });
const memberIndex = fc.integer({ min: 0, max: MEMBERS.length - 1 });

function grantOf(rank: number, permissions: string[]): GrantView {
  return { roleCode: `R${rank}`, rank, permissions, scope: TENANT, status: 'Active', effectiveFrom: PAST, effectiveUntil: null };
}

function accessOf(membershipId: string, grants: GrantView[]): EffectiveAccess {
  return { membershipId, scopeVersion: 1, membershipActive: true, grants };
}

describe('anti-escalation properties', () => {
  it('an ok result implies a lower rank and covered permissions, and never a system permission', () => {
    fc.assert(
      fc.property(fc.array(role, { minLength: 1, maxLength: 4 }), role, (held, wanted) => {
        const grantor = accessOf('grantor', held.map((r) => grantOf(r.rank, r.permissions)));
        const result = checkGrant({ grantor, recipientMembershipId: 'recipient', role: wanted, requestedScope: TENANT, now: NOW });
        if (!result.ok) return true;
        const heldPermissions = activeGrants(grantor, NOW).flatMap((g) => g.permissions);
        return (
          wanted.rank < maxRank(grantor, NOW, TENANT) &&
          wanted.permissions.every((p) => permissionCovered(heldPermissions, p)) &&
          wanted.permissions.every((p) => !p.startsWith('system.')) &&
          permissionCovered(heldPermissions, 'iam.role.grant')
        );
      }),
      { numRuns: 500 },
    );
  });

  it('a chain of successful grants never gives a member a permission that no initial holder had', () => {
    const step = fc.record({ grantor: memberIndex, recipient: memberIndex, role });
    fc.assert(
      fc.property(fc.array(role, { minLength: 1, maxLength: 3 }), fc.array(step, { maxLength: 25 }), (initial, steps) => {
        const grants: GrantView[][] = MEMBERS.map(() => []);
        const granted: GrantView[] = [];
        const universe = initial.flatMap((r) => r.permissions);
        grants[0] = initial.map((r) => grantOf(r.rank, r.permissions));
        for (const { grantor, recipient, role: wanted } of steps) {
          const result = checkGrant({
            grantor: accessOf(MEMBERS[grantor] as string, grants[grantor] as GrantView[]),
            recipientMembershipId: MEMBERS[recipient] as string,
            role: wanted,
            requestedScope: TENANT,
            now: NOW,
          });
          if (!result.ok) continue;
          const created = grantOf(wanted.rank, wanted.permissions);
          (grants[recipient] as GrantView[]).push(created);
          granted.push(created);
        }
        return granted.every((g) => g.permissions.every((p) => permissionCovered(universe, p)));
      }),
      { numRuns: 500 },
    );
  });

  it('a granted role always ranks below the highest initial rank', () => {
    const step = fc.record({ grantor: memberIndex, recipient: memberIndex, role });
    fc.assert(
      fc.property(fc.array(role, { minLength: 1, maxLength: 3 }), fc.array(step, { maxLength: 25 }), (initial, steps) => {
        const grants: GrantView[][] = MEMBERS.map(() => []);
        const granted: GrantView[] = [];
        grants[0] = initial.map((r) => grantOf(r.rank, r.permissions));
        const ceiling = Math.max(...initial.map((r) => r.rank));
        for (const { grantor, recipient, role: wanted } of steps) {
          const result = checkGrant({
            grantor: accessOf(MEMBERS[grantor] as string, grants[grantor] as GrantView[]),
            recipientMembershipId: MEMBERS[recipient] as string,
            role: wanted,
            requestedScope: TENANT,
            now: NOW,
          });
          if (!result.ok) continue;
          const created = grantOf(wanted.rank, wanted.permissions);
          (grants[recipient] as GrantView[]).push(created);
          granted.push(created);
        }
        return granted.every((g) => g.rank < ceiling);
      }),
      { numRuns: 300 },
    );
  });
});
