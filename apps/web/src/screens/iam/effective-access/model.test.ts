import { describe, expect, it } from 'vitest';
import { NO_FILTER, breadcrumbText, filterGrants, groupGrants, isScopeKind, isStale, permissionRows, summaryOf } from './model';
import type { AccessDelegation, AccessGrant } from './types';

function grant(overrides: Partial<AccessGrant> & { id: string }): AccessGrant {
  return {
    roleCode: 'MEMBER',
    roleName: 'iam.role.MEMBER.name',
    rank: 5,
    scopeKind: 'TENANT',
    scopeRefIds: [],
    units: [],
    projects: [],
    contracts: [],
    permissions: ['session.self'],
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveUntil: null,
    state: 'ACTIVE',
    ...overrides,
  };
}

const delegation = (overrides: Partial<AccessDelegation> = {}): AccessDelegation => ({
  id: 'd1',
  delegatorMembershipId: 'm2',
  permissions: ['approval.decide'],
  scopeKind: 'UNIT_SUBTREE',
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-02-01T00:00:00.000Z',
  state: 'ACTIVE',
  ...overrides,
});

describe('groupGrants', () => {
  it('separates the grants in force, the ones that ended and the ones that have not started, keeping the order', () => {
    const groups = groupGrants([grant({ id: 'a' }), grant({ id: 'b', state: 'EXPIRED' }), grant({ id: 'c', state: 'FUTURE' }), grant({ id: 'd' })]);
    expect(groups.active.map((item) => item.id)).toEqual(['a', 'd']);
    expect(groups.expired.map((item) => item.id)).toEqual(['b']);
    expect(groups.future.map((item) => item.id)).toEqual(['c']);
  });
});

describe('filterGrants', () => {
  const grants = [
    grant({ id: 'a', roleCode: 'UNIT_ADMIN', scopeKind: 'UNIT_SUBTREE', permissions: ['iam.member.*', 'iam.role.grant'] }),
    grant({ id: 'b', roleCode: 'MEMBER', scopeKind: 'TENANT', permissions: ['session.self'] }),
    grant({ id: 'c', roleCode: 'SPECIALIST', scopeKind: 'PROJECT', permissions: [] }),
  ];

  it('keeps everything without a filter', () => {
    expect(filterGrants(grants, NO_FILTER)).toHaveLength(3);
  });

  it('keeps the grants one of whose permissions contains the text, whatever its case, and so does a pattern', () => {
    expect(filterGrants(grants, { ...NO_FILTER, permission: ' ROLE.GR ' }).map((item) => item.id)).toEqual(['a']);
    expect(filterGrants(grants, { ...NO_FILTER, permission: 'iam.member' }).map((item) => item.id)).toEqual(['a']);
    expect(filterGrants(grants, { ...NO_FILTER, permission: 'nothing' })).toEqual([]);
  });

  it('keeps the grants of one scope kind, and combines both filters', () => {
    expect(filterGrants(grants, { permission: '', scope: 'TENANT' }).map((item) => item.id)).toEqual(['b']);
    expect(filterGrants(grants, { permission: 'iam', scope: 'TENANT' })).toEqual([]);
    expect(filterGrants(grants, { permission: 'iam', scope: 'UNIT_SUBTREE' }).map((item) => item.id)).toEqual(['a']);
  });

  it('knows a scope kind from any other text', () => {
    expect(isScopeKind('PROJECT')).toBe(true);
    expect(isScopeKind('project')).toBe(false);
    expect(isScopeKind('ALL')).toBe(false);
  });
});

describe('permissionRows', () => {
  it('is the union of the permissions of the grants in force with every role that gives each, sorted by name', () => {
    const rows = permissionRows(
      [
        grant({ id: 'a', roleCode: 'UNIT_ADMIN', permissions: ['session.self', 'iam.role.grant'] }),
        grant({ id: 'b', roleCode: 'MEMBER', permissions: ['session.self'] }),
        grant({ id: 'c', roleCode: 'ENDED', permissions: ['audit.read'], state: 'EXPIRED' }),
        grant({ id: 'd', roleCode: 'LATER', permissions: ['report.export'], state: 'FUTURE' }),
      ],
      [],
    );
    expect(rows).toEqual([
      { permission: 'iam.role.grant', roles: ['UNIT_ADMIN'], delegated: false },
      { permission: 'session.self', roles: ['MEMBER', 'UNIT_ADMIN'], delegated: false },
    ]);
  });

  it('adds the permissions of the delegations in force, marked as delegated, and ignores the ones that have not started', () => {
    const rows = permissionRows([grant({ id: 'a', permissions: ['approval.decide'] })], [delegation(), delegation({ id: 'd2', permissions: ['report.export'], state: 'FUTURE' })]);
    expect(rows).toEqual([{ permission: 'approval.decide', roles: ['MEMBER'], delegated: true }]);
    expect(permissionRows([], [delegation()])).toEqual([{ permission: 'approval.decide', roles: [], delegated: true }]);
  });
});

describe('summaryOf', () => {
  it('counts the roles and scopes in force, what ended or has not started, and the delegations', () => {
    const summary = summaryOf({
      grants: [
        grant({ id: 'a', roleCode: 'UNIT_ADMIN', scopeKind: 'UNIT_SUBTREE', scopeRefIds: ['u2', 'u1'] }),
        grant({ id: 'b', roleCode: 'UNIT_ADMIN', scopeKind: 'UNIT_SUBTREE', scopeRefIds: ['u1', 'u2'] }),
        grant({ id: 'c', roleCode: 'MEMBER' }),
        grant({ id: 'd', state: 'EXPIRED' }),
        grant({ id: 'e', state: 'FUTURE' }),
      ],
      delegations: [delegation()],
    });
    expect(summary).toEqual({ activeRoles: 2, scopes: 2, endedOrPending: 2, delegations: 1 });
  });
});

describe('isStale', () => {
  it('is true only when both versions are known and differ', () => {
    expect(isStale(3, 4)).toBe(true);
    expect(isStale(3, 3)).toBe(false);
    expect(isStale(undefined, 4)).toBe(false);
    expect(isStale(3, undefined)).toBe(false);
  });
});

describe('breadcrumbText', () => {
  it('reads from the root down, uses the code when a unit has no name, and shows the unit alone when it has no chain', () => {
    expect(breadcrumbText({ name: 'B', code: 'U2', breadcrumb: [{ name: 'A', code: 'U1' }, { name: '', code: 'U2' }] })).toBe('A › U2');
    expect(breadcrumbText({ name: 'Solo', code: 'U9', breadcrumb: [] })).toBe('Solo');
  });
});
