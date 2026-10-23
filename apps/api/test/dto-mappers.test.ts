import { DomainError } from '@machvon/kernel';
import { grantCreateOf, roleCreateOf, roleUpdateOf } from '../src/iam-dto';
import { orgUnitCreateOf, orgUnitMoveOf, orgUnitUpdateOf, todayInVietnam } from '../src/org-unit-dto';

const MEMBERSHIP = '00000000-0000-4000-8000-0000000000F1';
const ROLE = '00000000-0000-4000-8000-0000000000E1';
const UNIT = '00000000-0000-4000-8000-0000000000A1';

function thrown(action: () => unknown): DomainError {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

describe('role mappers', () => {
  it('maps a role body to the DTO and defaults guest_allowed to false', () => {
    expect(roleCreateOf({ code: 'UNIT_CLERK', name: 'Clerk', permissions: ['iam.unit.manage'], rank: 35 })).toEqual({
      code: 'UNIT_CLERK',
      name: 'Clerk',
      permissions: ['iam.unit.manage'],
      rank: 35,
      guestAllowed: false,
    });
    expect(roleCreateOf({ code: 'UNIT_CLERK', name: 'Clerk', permissions: ['iam.unit.manage'], rank: 35, guest_allowed: true }).guestAllowed).toBe(true);
  });

  it('refuses an empty role name, which the schema leaves open', () => {
    expect(thrown(() => roleCreateOf({ code: 'UNIT_CLERK', name: '', permissions: ['iam.unit.manage'], rank: 35 }))).toMatchObject({ code: 'INVALID_REQUEST', detail: 'name' });
    expect(thrown(() => roleUpdateOf({ name: '', permissions: ['iam.unit.manage'], reason: 'long enough reason' }))).toMatchObject({ code: 'INVALID_REQUEST', detail: 'name' });
  });

  it('maps an update and leaves absent members absent', () => {
    expect(roleUpdateOf({ permissions: ['iam.unit.manage'], reason: 'long enough reason' })).toEqual({ permissions: ['iam.unit.manage'], reason: 'long enough reason' });
    expect(roleUpdateOf({ name: 'New', rank: 40, permissions: ['iam.unit.manage'], reason: 'long enough reason' })).toMatchObject({ name: 'New', rank: 40 });
  });
});

describe('grantCreateOf', () => {
  const base = { membership_id: MEMBERSHIP, role_id: ROLE, scope_kind: 'TENANT' as const, reason: 'long enough reason' };

  it('lower-cases the ids and normalises the times', () => {
    const grant = grantCreateOf({ ...base, scope_kind: 'UNIT_ONLY', scope_ref_ids: [UNIT], effective_from: '2026-10-23T08:00:00+07:00' });
    expect(grant).toMatchObject({
      membershipId: MEMBERSHIP.toLowerCase(),
      roleId: ROLE.toLowerCase(),
      scopeRefIds: [UNIT.toLowerCase()],
      effectiveFrom: '2026-10-23T01:00:00.000Z',
    });
  });

  it('requires references exactly when the scope is not the whole tenant', () => {
    expect(thrown(() => grantCreateOf({ ...base, scope_ref_ids: [UNIT] }))).toMatchObject({ code: 'INVALID_REQUEST', detail: 'scope_ref_ids' });
    expect(thrown(() => grantCreateOf({ ...base, scope_kind: 'UNIT_ONLY' }))).toMatchObject({ code: 'INVALID_REQUEST', detail: 'scope_ref_ids' });
    expect(grantCreateOf(base).scopeRefIds).toEqual([]);
  });

  it('refuses a window that ends before it starts, or an end in the past without a start, with 422', () => {
    const backwards = thrown(() => grantCreateOf({ ...base, effective_from: '2026-10-23T08:00:00Z', effective_until: '2026-10-23T07:00:00Z' }));
    expect(backwards).toMatchObject({ code: 'VALIDATION_FAILED', status: 422, detail: 'effective_until' });
    const now = Date.parse('2026-10-23T08:00:00Z');
    expect(thrown(() => grantCreateOf({ ...base, effective_until: '2026-10-23T07:59:59Z' }, now))).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(thrown(() => grantCreateOf({ ...base, effective_until: '2026-10-23T08:00:00Z' }, now))).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(grantCreateOf({ ...base, effective_until: '2026-10-23T08:00:01Z' }, now).effectiveUntil).toBe('2026-10-23T08:00:01.000Z');
  });
});

describe('organisation unit mappers', () => {
  it('maps create and update bodies field by field', () => {
    expect(orgUnitCreateOf({ code: 'U1', name: 'Unit', parent_id: UNIT, unit_type: 'DEPARTMENT', valid_from: '2026-02-01', is_investor: true })).toMatchObject({
      code: 'U1',
      parentId: UNIT.toLowerCase(),
      unitType: 'DEPARTMENT',
      validFrom: '2026-02-01',
      isInvestor: true,
    });
    expect(orgUnitUpdateOf({ administrative_code: '', legal_basis_ref: 'ref' })).toEqual({
      code: undefined,
      name: undefined,
      isInvestor: undefined,
      administrativeCode: '',
      legalBasisRef: 'ref',
    });
  });

  it('refuses a move dated after today in Vietnam and accepts today and the past', () => {
    const body = { new_parent_id: UNIT, reason: 'a reason long enough' };
    expect(thrown(() => orgUnitMoveOf({ ...body, effective_from: '2026-10-24' }, '2026-10-23'))).toMatchObject({ code: 'VALIDATION_FAILED', status: 422, detail: 'effective_from' });
    expect(orgUnitMoveOf({ ...body, effective_from: '2026-10-23' }, '2026-10-23').effectiveFrom).toBe('2026-10-23');
    expect(orgUnitMoveOf({ ...body, effective_from: '2026-01-01' }, '2026-10-23').newParentId).toBe(UNIT.toLowerCase());
  });

  it('computes today in the Vietnam calendar, not the server calendar', () => {
    expect(todayInVietnam(new Date('2026-10-22T18:30:00Z'))).toBe('2026-10-23');
    expect(todayInVietnam(new Date('2026-10-22T16:30:00Z'))).toBe('2026-10-22');
  });
});
