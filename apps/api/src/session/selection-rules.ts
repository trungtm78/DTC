import { DomainError } from '@machvon/kernel';

export type SessionMode = 'FULL' | 'READ_ONLY';

/** The membership must be Active and inside `[valid_from, valid_until)` (BR-IAM-02). */
export function checkMembership(membership: { status: string; insideValidity: boolean }): void {
  if (membership.status !== 'Active' || !membership.insideValidity) throw new DomainError('MEMBERSHIP_INACTIVE', 403);
}

/**
 * Only an Active tenant, or a Suspended one whose access policy still allows reading and exporting, can be entered
 * (IAM 3.2). The second answer is a read-only session; every other state, and a suspension for a security
 * incident, is refused.
 */
export function modeOfTenant(tenant: { status: string; accessPolicy?: string }): SessionMode {
  if (tenant.status === 'Active') return 'FULL';
  if (tenant.status === 'Suspended' && tenant.accessPolicy === 'READ_ONLY_EXPORT') return 'READ_ONLY';
  throw new DomainError('TENANT_SUSPENDED', 403);
}

/** A membership holding a role that the tenant's security policy lists needs a second factor to select the tenant (BR-IAM-11). */
export function checkAssurance(input: { roleCodes: readonly string[]; mfaRequiredRoles: readonly string[]; assurance: 'aal1' | 'aal2' }): void {
  if (input.assurance === 'aal2') return;
  if (input.roleCodes.some((role) => input.mfaRequiredRoles.includes(role))) throw new DomainError('MFA_REQUIRED', 403);
}
