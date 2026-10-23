/** Why a tenant is suspended (`TenantSuspend.reason_code`, SAS 3.2). */
export const SUSPENSION_REASON_CODES = ['NON_PAYMENT', 'SECURITY_INCIDENT', 'CUSTOMER_REQUEST', 'LICENSE_REVOKED', 'LEGAL_ORDER'] as const;
export type SuspensionReasonCode = (typeof SUSPENSION_REASON_CODES)[number];

/** What a suspended tenant may still do: read and export, or nothing at all. */
export type AccessPolicy = 'READ_ONLY_EXPORT' | 'NO_ACCESS';

/** A reason is 10 to 2000 characters of the contract (`TenantSuspend.reason`, `ReasonOnly.reason`). */
export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 2000;

export type LifecycleAction = 'suspend' | 'resume';

/**
 * The policy a reason implies: the server derives it from the stored reason, so only a security incident blocks access
 * and the form shows the policy instead of asking for it.
 */
export function accessPolicyOf(code: SuspensionReasonCode): AccessPolicy {
  return code === 'SECURITY_INCIDENT' ? 'NO_ACCESS' : 'READ_ONLY_EXPORT';
}

export function isReasonCode(value: string): value is SuspensionReasonCode {
  return (SUSPENSION_REASON_CODES as readonly string[]).includes(value);
}

/** Whether a reason can be sent: its trimmed length lies within the contract. */
export function isReasonValid(reason: string): boolean {
  const length = reason.trim().length;
  return length >= REASON_MIN_LENGTH && length <= REASON_MAX_LENGTH;
}

/** The buttons the state machine offers for a status (Active suspends, Suspended resumes) to a person who may manage tenants. */
export function lifecycleActions(status: string, canManage: boolean): LifecycleAction[] {
  if (!canManage) return [];
  if (status === 'Active') return ['suspend'];
  if (status === 'Suspended') return ['resume'];
  return [];
}
