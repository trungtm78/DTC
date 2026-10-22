import { decide } from '../src/decision';
import type { DecideInput } from '../src/decision';
import type { EffectiveAccess, GrantView } from '../src/effective-access';

const NOW = new Date('2026-10-23T10:00:00.000Z');
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

const grant = (permissions: string[], overrides: Partial<GrantView> = {}): GrantView => ({
  roleCode: 'LEADER',
  rank: 60,
  permissions,
  scope: { kind: 'TENANT' },
  status: 'Active',
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveUntil: null,
  ...overrides,
});

const accessWith = (grants: GrantView[], scopeVersion = 5, membershipActive = true): EffectiveAccess => ({
  membershipId: MEMBERSHIP,
  scopeVersion,
  membershipActive,
  grants,
});

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    required: { permission: 'iam.role.grant', plane: 'tenant' },
    principal: { audience: 'tenant', assurance: 'aal1', sessionRevoked: false, tokenScopeVersion: 5 },
    access: accessWith([grant(['iam.role.grant'])]),
    now: NOW,
    ...overrides,
  };
}

describe('decide', () => {
  it('allows a held permission on the right plane', () => {
    expect(decide(input())).toEqual({ allow: true });
  });

  it('allows through a wildcard pattern', () => {
    expect(decide(input({ access: accessWith([grant(['iam.*'])]) }))).toEqual({ allow: true });
  });

  it('refuses a tenant-plane token on a control-plane operation with 403 SCOPE_DENIED (reason PLANE)', () => {
    expect(decide(input({ required: { permission: 'iam.role.grant', plane: 'control' } }))).toEqual({
      allow: false,
      reason: 'PLANE',
      code: 'SCOPE_DENIED',
      status: 403,
    });
  });

  it('refuses a revoked session with 401 SESSION_EXPIRED before it looks at permissions', () => {
    const principal = { audience: 'tenant' as const, assurance: 'aal1' as const, sessionRevoked: true, tokenScopeVersion: 5 };
    expect(decide(input({ principal }))).toEqual({ allow: false, reason: 'SESSION_REVOKED', code: 'SESSION_EXPIRED', status: 401 });
  });

  it('refuses a permission nobody granted with NO_PERMISSION', () => {
    expect(decide(input({ access: accessWith([grant(['audit.read'])]) }))).toEqual({
      allow: false,
      reason: 'NO_PERMISSION',
      code: 'SCOPE_DENIED',
      status: 403,
    });
  });

  it('names a stale token as the reason when the permission was removed since it was issued', () => {
    const principal = { audience: 'tenant' as const, assurance: 'aal1' as const, sessionRevoked: false, tokenScopeVersion: 4 };
    expect(decide(input({ principal, access: accessWith([], 5) }))).toMatchObject({ allow: false, reason: 'STALE_SCOPE_VERSION', code: 'SCOPE_DENIED' });
  });

  it('does not treat a stale or newer token as a reason to deny when the database still holds the permission', () => {
    const older = { audience: 'tenant' as const, assurance: 'aal1' as const, sessionRevoked: false, tokenScopeVersion: 1 };
    const newer = { ...older, tokenScopeVersion: 9 };
    expect(decide(input({ principal: older }))).toEqual({ allow: true });
    expect(decide(input({ principal: newer }))).toEqual({ allow: true });
    expect(decide(input({ principal: newer, access: accessWith([], 5) }))).toMatchObject({ reason: 'NO_PERMISSION' });
  });

  it('checks the permission on the scope that contains the resource', () => {
    const scoped = accessWith([grant(['iam.role.grant'], { scope: { kind: 'UNIT_SUBTREE', refIds: ['1'], paths: ['/a/1/'] } })]);
    expect(decide(input({ access: scoped, resource: { ownerUnitPath: '/a/1/2/', ownerUnitId: '2' } }))).toEqual({ allow: true });
    expect(decide(input({ access: scoped, resource: { ownerUnitPath: '/a/12/', ownerUnitId: '12' } }))).toMatchObject({ reason: 'NO_PERMISSION' });
  });

  it('refuses everything for a membership that is not Active', () => {
    expect(decide(input({ access: accessWith([grant(['iam.role.grant'])], 5, false) }))).toMatchObject({ reason: 'NO_PERMISSION' });
  });

  it('refuses with ENTITLEMENT_DENIED when the tenant is not entitled to the permission', () => {
    expect(decide(input({ entitled: () => false }))).toEqual({ allow: false, reason: 'ENTITLEMENT', code: 'ENTITLEMENT_DENIED', status: 403 });
    const seen: string[] = [];
    expect(decide(input({ entitled: (permission) => (seen.push(permission), true) }))).toEqual({ allow: true });
    expect(seen).toEqual(['iam.role.grant']);
  });

  describe('step-up', () => {
    const stepUp = { permission: 'iam.role.grant', plane: 'tenant' as const, stepUp: 'aal2' as const };
    const aal2 = (aal2At?: Date) => ({ audience: 'tenant' as const, assurance: 'aal2' as const, aal2At, sessionRevoked: false, tokenScopeVersion: 5 });

    it('demands 403 MFA_REQUIRED from an aal1 token', () => {
      expect(decide(input({ required: stepUp }))).toEqual({ allow: false, reason: 'STEP_UP', code: 'MFA_REQUIRED', status: 403 });
    });

    it('accepts aal2 within 15 minutes, including exactly 15, and refuses older or undated aal2', () => {
      expect(decide(input({ required: stepUp, principal: aal2(minutesAgo(14)) }))).toEqual({ allow: true });
      expect(decide(input({ required: stepUp, principal: aal2(minutesAgo(15)) }))).toEqual({ allow: true });
      expect(decide(input({ required: stepUp, principal: aal2(minutesAgo(16)) }))).toMatchObject({ reason: 'STEP_UP' });
      expect(decide(input({ required: stepUp, principal: aal2() }))).toMatchObject({ reason: 'STEP_UP' });
    });

    it('answers a missing permission before it asks for step-up', () => {
      expect(decide(input({ required: stepUp, access: accessWith([]) }))).toMatchObject({ reason: 'NO_PERMISSION' });
    });
  });
});
