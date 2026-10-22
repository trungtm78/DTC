import { activeGrants, effectivePermissions, maxRank } from '../src/effective-access';
import type { EffectiveAccess, GrantView } from '../src/effective-access';

const NOW = new Date('2026-10-23T10:00:00.000Z');
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';

function grant(overrides: Partial<GrantView> = {}): GrantView {
  return {
    roleCode: 'UNIT_ADMIN',
    rank: 70,
    permissions: ['iam.unit.manage'],
    scope: { kind: 'TENANT' },
    status: 'Active',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveUntil: null,
    ...overrides,
  };
}

function access(grants: GrantView[], membershipActive = true): EffectiveAccess {
  return { membershipId: MEMBERSHIP, scopeVersion: 3, membershipActive, grants };
}

describe('activeGrants', () => {
  it('keeps a grant that is active now and drops ended, future and non-Active ones', () => {
    const live = grant();
    const ended = grant({ effectiveUntil: new Date(NOW.getTime() - 1) });
    const endsNow = grant({ effectiveUntil: NOW });
    const future = grant({ effectiveFrom: new Date(NOW.getTime() + 1) });
    const startsNow = grant({ effectiveFrom: NOW });
    const revoked = grant({ status: 'Revoked' });
    expect(activeGrants(access([live, ended, endsNow, future, startsNow, revoked]), NOW)).toEqual([live, startsNow]);
  });

  it('returns nothing for a membership that is not Active', () => {
    expect(activeGrants(access([grant()], false), NOW)).toEqual([]);
  });
});

describe('effectivePermissions', () => {
  const unit1 = grant({ permissions: ['iam.unit.manage'], scope: { kind: 'UNIT_SUBTREE', refIds: ['1'], paths: ['/a/1/'] } });
  const unit2 = grant({ permissions: ['audit.read', 'iam.unit.manage'], scope: { kind: 'UNIT_ONLY', refIds: ['2'] } });

  it('unions the permissions of every active grant when no resource is given', () => {
    expect(effectivePermissions(access([unit1, unit2]), NOW)).toEqual(new Set(['iam.unit.manage', 'audit.read']));
  });

  it('keeps only grants whose scope contains the resource', () => {
    const inUnit2 = { ownerUnitPath: '/a/2/', ownerUnitId: '2' };
    expect(effectivePermissions(access([unit1, unit2]), NOW, inUnit2)).toEqual(new Set(['audit.read', 'iam.unit.manage']));
    const inUnit1 = { ownerUnitPath: '/a/1/7/', ownerUnitId: '7' };
    expect(effectivePermissions(access([unit1, unit2]), NOW, inUnit1)).toEqual(new Set(['iam.unit.manage']));
    const elsewhere = { ownerUnitPath: '/a/9/', ownerUnitId: '9' };
    expect(effectivePermissions(access([unit1, unit2]), NOW, elsewhere)).toEqual(new Set());
  });

  it('is empty for a membership that is not Active', () => {
    expect(effectivePermissions(access([unit1], false), NOW)).toEqual(new Set());
  });
});

describe('maxRank', () => {
  it('takes the highest rank among active grants that cover the scope, and 0 when none does', () => {
    const wide = grant({ rank: 90, scope: { kind: 'UNIT_SUBTREE', refIds: ['1'], paths: ['/a/1/'] } });
    const narrow = grant({ rank: 70, scope: { kind: 'UNIT_ONLY', refIds: ['5'], paths: ['/a/1/5/'] } });
    const ended = grant({ rank: 99, effectiveUntil: NOW });
    const target = { kind: 'UNIT_ONLY' as const, refIds: ['5'], paths: ['/a/1/5/'] };
    expect(maxRank(access([wide, narrow, ended]), NOW, target)).toBe(90);
    expect(maxRank(access([narrow]), NOW, target)).toBe(70);
    expect(maxRank(access([narrow, wide]), NOW, { kind: 'UNIT_ONLY', refIds: ['9'], paths: ['/a/9/'] })).toBe(0);
    expect(maxRank(access([ended]), NOW, target)).toBe(0);
  });
});
