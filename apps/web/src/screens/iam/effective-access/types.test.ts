import { describe, expect, it } from 'vitest';
import { toEffectiveAccess } from './types';

describe('toEffectiveAccess', () => {
  it('reads the contract fields of grants, scopes and delegations', () => {
    const view = toEffectiveAccess({
      membership_id: 'm1',
      scope_version: 7,
      entitlement_hash: 'h1',
      grants: [
        {
          id: 'g1',
          role_code: 'UNIT_ADMIN',
          role_name: 'iam.role.UNIT_ADMIN.name',
          rank: 70,
          scope_kind: 'UNIT_SUBTREE',
          scope_ref_ids: ['u2'],
          scope: {
            units: [{ id: 'u2', code: 'U2', name: 'Unit 2', path: '/a/b/', breadcrumb: [{ id: 'u1', code: 'U1', name: 'Unit 1' }, { id: 'u2', code: 'U2', name: 'Unit 2' }] }],
            projects: [{ id: 'p1', code: 'P', name: 'Project' }],
            contracts: [{ id: 'c1', code: 'C' }],
          },
          permissions: ['iam.member.*'],
          effective_from: '2026-01-01T00:00:00.000Z',
          effective_until: '2026-02-01T00:00:00.000Z',
          state: 'FUTURE',
        },
      ],
      delegations_in: [{ id: 'd1', delegator_membership_id: 'm2', permissions: ['approval.decide'], scope_kind: 'TENANT', scope_ref_ids: [], valid_from: 'a', valid_until: 'b', state: 'FUTURE' }],
    });
    expect(view).toMatchObject({ membershipId: 'm1', scopeVersion: 7, entitlementHash: 'h1' });
    expect(view.grants[0]).toMatchObject({
      id: 'g1',
      roleCode: 'UNIT_ADMIN',
      rank: 70,
      scopeKind: 'UNIT_SUBTREE',
      scopeRefIds: ['u2'],
      permissions: ['iam.member.*'],
      effectiveUntil: '2026-02-01T00:00:00.000Z',
      state: 'FUTURE',
      projects: [{ id: 'p1', code: 'P', name: 'Project' }],
      contracts: [{ id: 'c1', code: 'C' }],
    });
    expect(view.grants[0]?.units[0]).toMatchObject({ id: 'u2', path: '/a/b/', breadcrumb: [{ code: 'U1' }, { code: 'U2' }] });
    expect(view.delegations[0]).toMatchObject({ id: 'd1', delegatorMembershipId: 'm2', state: 'FUTURE' });
  });

  it('survives an answer of the wrong shape: every field falls back to an empty value, an unknown kind to the whole tenant', () => {
    expect(toEffectiveAccess(undefined)).toEqual({ membershipId: '', scopeVersion: 0, grants: [], delegations: [], entitlementHash: undefined });
    const view = toEffectiveAccess({ grants: [{ scope_kind: 'GALAXY', state: 'WEIRD', permissions: [1, 'a'], effective_until: 5, scope: 'x' }, 7], delegations_in: [{}] });
    expect(view.grants[0]).toMatchObject({ scopeKind: 'TENANT', state: 'ACTIVE', permissions: ['a'], effectiveUntil: null, units: [], projects: [], contracts: [] });
    expect(view.grants[1]).toMatchObject({ id: '', rank: 0 });
    expect(view.delegations[0]).toMatchObject({ id: '', state: 'ACTIVE', permissions: [] });
  });
});
