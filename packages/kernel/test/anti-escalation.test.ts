import { checkGrant, checkRoleDefinition, permissionCovered } from '../src/anti-escalation';
import type { EffectiveAccess, GrantView } from '../src/effective-access';
import type { Scope } from '../src/scope';

const NOW = new Date('2026-10-23T03:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');
const GRANTOR = '00000000-0000-4000-8000-0000000000a1';
const RECIPIENT = '00000000-0000-4000-8000-0000000000b1';

const TENANT: Scope = { kind: 'TENANT' };
const BOARD: Scope = { kind: 'UNIT_SUBTREE', refIds: ['board'], paths: ['/root/board/'] };
const DEPARTMENT: Scope = { kind: 'UNIT_SUBTREE', refIds: ['dept'], paths: ['/root/dept/'] };
const BOARD_UNIT: Scope = { kind: 'UNIT_ONLY', refIds: ['board-1'], paths: ['/root/board/board-1/'] };

function grant(roleCode: string, rank: number, permissions: string[], scope: Scope, overrides: Partial<GrantView> = {}): GrantView {
  return { roleCode, rank, permissions, scope, status: 'Active', effectiveFrom: PAST, effectiveUntil: null, ...overrides };
}

function access(grants: GrantView[], overrides: Partial<EffectiveAccess> = {}): EffectiveAccess {
  return { membershipId: GRANTOR, scopeVersion: 1, membershipActive: true, grants, ...overrides };
}

const TENANT_ADMIN = grant('TENANT_ADMIN', 90, ['iam.*', 'adm.*', 'audit.read'], TENANT);
const UNIT_ADMIN_OF_BOARD = grant('UNIT_ADMIN', 70, ['iam.member.*', 'iam.role.grant', 'iam.unit.manage'], BOARD);

const input = (grantor: EffectiveAccess, role: { rank: number; permissions: string[] }, requestedScope: Scope, recipientMembershipId = RECIPIENT) => ({
  grantor,
  recipientMembershipId,
  role,
  requestedScope,
  now: NOW,
});

describe('permissionCovered', () => {
  it.each([
    [['iam.*'], 'iam.unit.manage', true],
    [['iam.*'], 'iam.*', true],
    [['iam.*'], 'iam.unit.*', true],
    [['iam.unit.manage'], 'iam.unit.manage', true],
    [['iam.unit.manage'], 'iam.*', false],
    [['iam.unit.manage'], 'iam.unit.*', false],
    [['iam.member.*'], 'iam.*', false],
    [['iam.*'], 'iamx.read', false],
    [['*'], 'iam.read', false],
    [[], 'iam.read', false],
    [['audit.read', 'iam.*'], 'iam.role.grant', true],
  ])('held %j covers %s: %s', (held, wanted, expected) => {
    expect(permissionCovered(held, wanted)).toBe(expected);
  });

  it('accepts a set as well as an array', () => {
    expect(permissionCovered(new Set(['adm.*']), 'adm.workflow.manage')).toBe(true);
  });
});

describe('checkGrant (BR-IAM-05)', () => {
  it('AC-ST-ADM-005-1: a TENANT_ADMIN of rank 90 cannot grant TENANT_ADMIN but can grant UNIT_ADMIN', () => {
    const grantor = access([TENANT_ADMIN]);
    expect(checkGrant(input(grantor, { rank: 90, permissions: ['iam.*', 'adm.*', 'audit.read'] }, TENANT))).toEqual({
      ok: false,
      code: 'ROLE_ESCALATION_DENIED',
      status: 403,
    });
    expect(checkGrant(input(grantor, { rank: 70, permissions: ['iam.member.*', 'iam.role.grant', 'iam.unit.manage'] }, TENANT))).toEqual({ ok: true });
  });

  it('AC-ST-ADM-005-2: granting to oneself is SELF_GRANT_DENIED, before any other check', () => {
    const grantor = access([UNIT_ADMIN_OF_BOARD]);
    expect(checkGrant(input(grantor, { rank: 60, permissions: ['approval.decide'] }, BOARD, GRANTOR))).toEqual({
      ok: false,
      code: 'SELF_GRANT_DENIED',
      status: 403,
    });
    expect(checkGrant(input(grantor, { rank: 99, permissions: ['system.tenant.manage'] }, DEPARTMENT, GRANTOR))).toMatchObject({ code: 'SELF_GRANT_DENIED' });
  });

  it('AC-ST-ADM-005-3: a unit admin of the board subtree cannot grant on another department but can inside the own subtree', () => {
    const grantor = access([UNIT_ADMIN_OF_BOARD]);
    const role = { rank: 40, permissions: ['iam.member.read'] };
    expect(checkGrant(input(grantor, role, DEPARTMENT))).toEqual({ ok: false, code: 'SCOPE_OUT_OF_GRANTOR_RANGE', status: 403 });
    expect(checkGrant(input(grantor, role, BOARD_UNIT))).toEqual({ ok: true });
    expect(checkGrant(input(grantor, role, BOARD))).toEqual({ ok: true });
    expect(checkGrant(input(grantor, role, TENANT))).toMatchObject({ code: 'SCOPE_OUT_OF_GRANTOR_RANGE' });
  });

  it('AC-ST-ADM-005-5: a role holding a system permission is SYSTEM_PERMISSION_NOT_GRANTABLE even for the tenant admin', () => {
    const grantor = access([TENANT_ADMIN]);
    for (const permission of ['system.theme.manage', 'system.license.manage', 'system.tenant.manage', 'system.billing.manage', 'system.anything.new']) {
      expect(checkGrant(input(grantor, { rank: 40, permissions: ['iam.member.read', permission] }, TENANT))).toEqual({
        ok: false,
        code: 'SYSTEM_PERMISSION_NOT_GRANTABLE',
        status: 422,
      });
    }
  });

  it('refuses a role permission that is broader than what the grantor holds', () => {
    const grantor = access([grant('UNIT_ADMIN', 70, ['iam.unit.manage', 'iam.role.grant'], BOARD)]);
    expect(checkGrant(input(grantor, { rank: 40, permissions: ['iam.*'] }, BOARD))).toMatchObject({ code: 'ROLE_ESCALATION_DENIED', status: 403 });
    expect(checkGrant(input(grantor, { rank: 40, permissions: ['iam.unit.manage', 'adm.workflow.manage'] }, BOARD))).toMatchObject({ code: 'ROLE_ESCALATION_DENIED' });
    expect(checkGrant(input(grantor, { rank: 40, permissions: ['iam.unit.manage'] }, BOARD))).toEqual({ ok: true });
  });

  it('lets a holder of iam.* grant both the pattern and a narrower permission', () => {
    const grantor = access([grant('TENANT_ADMIN', 90, ['iam.*'], TENANT)]);
    expect(checkGrant(input(grantor, { rank: 40, permissions: ['iam.*'] }, TENANT))).toEqual({ ok: true });
    expect(checkGrant(input(grantor, { rank: 40, permissions: ['iam.unit.manage'] }, TENANT))).toEqual({ ok: true });
  });

  it('does not count a grantor whose grant has not started, has ended, is revoked or whose membership is inactive', () => {
    const role = { rank: 10, permissions: ['iam.member.read'] };
    const future = grant('UNIT_ADMIN', 70, ['iam.*'], TENANT, { effectiveFrom: new Date(NOW.getTime() + 1) });
    const ended = grant('UNIT_ADMIN', 70, ['iam.*'], TENANT, { effectiveUntil: NOW });
    const revoked = grant('UNIT_ADMIN', 70, ['iam.*'], TENANT, { status: 'Revoked' });
    for (const g of [future, ended, revoked]) {
      expect(checkGrant(input(access([g]), role, TENANT))).toMatchObject({ code: 'SCOPE_OUT_OF_GRANTOR_RANGE' });
    }
    expect(checkGrant(input(access([TENANT_ADMIN], { membershipActive: false }), role, TENANT))).toMatchObject({ code: 'SCOPE_OUT_OF_GRANTOR_RANGE' });
  });

  it('needs iam.role.grant on the covering scope, not just any grant there', () => {
    const grantor = access([grant('AUDITOR', 25, ['audit.read'], TENANT)]);
    expect(checkGrant(input(grantor, { rank: 5, permissions: ['audit.read'] }, TENANT))).toMatchObject({ code: 'SCOPE_OUT_OF_GRANTOR_RANGE' });
  });

  it('takes the highest rank among every grant covering the scope, including grants without iam.role.grant', () => {
    const grantor = access([grant('UNIT_ADMIN', 70, ['iam.role.grant', 'iam.member.read'], TENANT), grant('LEADER', 80, ['approval.decide'], TENANT)]);
    expect(checkGrant(input(grantor, { rank: 80, permissions: ['iam.member.read'] }, TENANT))).toMatchObject({ code: 'ROLE_ESCALATION_DENIED' });
    expect(checkGrant(input(grantor, { rank: 79, permissions: ['iam.member.read'] }, TENANT))).toEqual({ ok: true });
  });

  it('refuses a bare wildcard and an empty permission as not covered', () => {
    const grantor = access([TENANT_ADMIN]);
    expect(checkGrant(input(grantor, { rank: 10, permissions: ['*'] }, TENANT))).toMatchObject({ code: 'ROLE_ESCALATION_DENIED' });
    expect(checkGrant(input(grantor, { rank: 10, permissions: [''] }, TENANT))).toMatchObject({ code: 'ROLE_ESCALATION_DENIED' });
  });
});

describe('checkRoleDefinition (ST-ADM-005 AC-4)', () => {
  const definition = (grantor: EffectiveAccess, permissions: string[], rank: number, scope: Scope = TENANT) => ({ grantor, permissions, rank, now: NOW, scope });
  const roleManager = access([grant('TENANT_ADMIN', 90, ['iam.role.manage', 'iam.member.read', 'adm.*'], TENANT)]);

  it('accepts a custom role the grantor could grant', () => {
    expect(checkRoleDefinition(definition(roleManager, ['iam.member.read', 'adm.workflow.manage'], 50))).toEqual({ ok: true });
  });

  it('refuses a system permission with 422 before any other check', () => {
    expect(checkRoleDefinition(definition(access([]), ['system.tenant.manage'], 99))).toEqual({
      ok: false,
      code: 'SYSTEM_PERMISSION_NOT_GRANTABLE',
      status: 422,
    });
  });

  it('refuses permissions the grantor lacks with 403 ROLE_ESCALATION_DENIED', () => {
    expect(checkRoleDefinition(definition(roleManager, ['payment.approve'], 50))).toEqual({ ok: false, code: 'ROLE_ESCALATION_DENIED', status: 403 });
  });

  it('refuses a rank at or above the grantor rank', () => {
    expect(checkRoleDefinition(definition(roleManager, ['iam.member.read'], 90))).toMatchObject({ code: 'ROLE_ESCALATION_DENIED' });
    expect(checkRoleDefinition(definition(roleManager, ['iam.member.read'], 89))).toEqual({ ok: true });
  });

  it('needs iam.role.manage on the scope', () => {
    const unitAdmin = access([UNIT_ADMIN_OF_BOARD]);
    expect(checkRoleDefinition(definition(unitAdmin, ['iam.member.read'], 40, BOARD))).toMatchObject({ code: 'SCOPE_OUT_OF_GRANTOR_RANGE' });
  });
});
