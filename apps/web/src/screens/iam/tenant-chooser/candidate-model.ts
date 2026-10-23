import type { TenantCandidate } from '../../../session/SessionContext';

/**
 * What the chooser lets a person do with a membership: choose it (`selectable`), choose it in read-only mode because
 * its tenant is suspended (`readOnly`), or not choose it at all because the membership is not in force (`inactive`) or
 * the tenant is not in a state that has users yet or any more (`unavailable`). The server decides again on every choice.
 */
export type Selectability = 'selectable' | 'readOnly' | 'inactive' | 'unavailable';

const ACTIVE = 'Active';
const SUSPENDED = 'Suspended';

function membershipInForce(candidate: TenantCandidate, nowMs: number): boolean {
  if (candidate.status !== ACTIVE) return false;
  if (Date.parse(candidate.valid_from) > nowMs) return false;
  // The end of the validity window is exclusive (IAM BR-IAM-02).
  return candidate.valid_until === null || candidate.valid_until === undefined || Date.parse(candidate.valid_until) > nowMs;
}

export function selectability(candidate: TenantCandidate, nowMs: number): Selectability {
  if (!membershipInForce(candidate, nowMs)) return 'inactive';
  if (candidate.tenant_status === ACTIVE) return 'selectable';
  return candidate.tenant_status === SUSPENDED ? 'readOnly' : 'unavailable';
}

/** The address to continue at after choosing: a local path only, so the `next` of the address cannot send anyone elsewhere. */
export function safeNext(value: string | null, fallback: string): string {
  if (value === null || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}
