import { DomainError } from '@machvon/kernel';
import { checkAssurance, checkMembership, modeOfTenant } from '../../src/session/selection-rules';

function codeOf(work: () => unknown): string | undefined {
  try {
    work();
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? `${error.code}:${error.status}` : 'other';
  }
}

describe('selection rules', () => {
  it('accepts an Active membership inside its validity and refuses the others with 403 MEMBERSHIP_INACTIVE', () => {
    expect(codeOf(() => checkMembership({ status: 'Active', insideValidity: true }))).toBeUndefined();
    expect(codeOf(() => checkMembership({ status: 'Suspended', insideValidity: true }))).toBe('MEMBERSHIP_INACTIVE:403');
    expect(codeOf(() => checkMembership({ status: 'Ended', insideValidity: true }))).toBe('MEMBERSHIP_INACTIVE:403');
    expect(codeOf(() => checkMembership({ status: 'Active', insideValidity: false }))).toBe('MEMBERSHIP_INACTIVE:403');
  });

  it('gives a full session for an Active tenant and a read-only one for a suspension that still allows reads', () => {
    expect(modeOfTenant({ status: 'Active' })).toBe('FULL');
    expect(modeOfTenant({ status: 'Suspended', accessPolicy: 'READ_ONLY_EXPORT' })).toBe('READ_ONLY');
  });

  it.each([
    ['a suspension for a security incident', { status: 'Suspended', accessPolicy: 'NO_ACCESS' }],
    ['a suspension without a policy', { status: 'Suspended' }],
    ['a tenant that is still provisioning', { status: 'Provisioning' }],
    ['a failed tenant', { status: 'Failed' }],
    ['an archived tenant', { status: 'Archived' }],
    ['an offboarding tenant', { status: 'Offboarding', accessPolicy: 'READ_ONLY_EXPORT' }],
    ['a tenant that is only requested', { status: 'Requested' }],
  ])('refuses %s with 403 TENANT_SUSPENDED', (_label, tenant) => {
    expect(codeOf(() => modeOfTenant(tenant))).toBe('TENANT_SUSPENDED:403');
  });

  it('demands aal2 only for a membership that holds a role of the security policy', () => {
    const policy = ['LEADER', 'TENANT_ADMIN'];
    expect(codeOf(() => checkAssurance({ roleCodes: ['LEADER'], mfaRequiredRoles: policy, assurance: 'aal1' }))).toBe('MFA_REQUIRED:403');
    expect(codeOf(() => checkAssurance({ roleCodes: ['LEADER'], mfaRequiredRoles: policy, assurance: 'aal2' }))).toBeUndefined();
    expect(codeOf(() => checkAssurance({ roleCodes: ['MEMBER'], mfaRequiredRoles: policy, assurance: 'aal1' }))).toBeUndefined();
    expect(codeOf(() => checkAssurance({ roleCodes: [], mfaRequiredRoles: policy, assurance: 'aal1' }))).toBeUndefined();
    expect(codeOf(() => checkAssurance({ roleCodes: ['MEMBER', 'TENANT_ADMIN'], mfaRequiredRoles: policy, assurance: 'aal1' }))).toBe('MFA_REQUIRED:403');
  });
});
