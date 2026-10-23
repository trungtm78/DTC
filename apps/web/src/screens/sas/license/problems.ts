import { ApiError } from '@machvon/api-client';
import { ISSUE_FIELDS } from './rules';
import type { IssueField } from './rules';

/** Why a license command failed, in the words of the license screens (the server's own `error.<CODE>` keys are not in this catalogue). */
export type ProblemReason =
  | 'rangeInvalid'
  | 'tenantMismatch'
  | 'tenantState'
  | 'signingKey'
  | 'stateInvalid'
  | 'conflict'
  | 'invalid'
  | 'fieldNotAllowed'
  | 'notFound'
  | 'denied'
  | 'stepUp'
  | 'session'
  | 'general';

export interface ProblemView {
  reason: ProblemReason;
  /** The form field the problem belongs to, when the server (or the code) names one. */
  field: IssueField | undefined;
  currentVersion: number | undefined;
}

const REASON_BY_CODE: Readonly<Record<string, ProblemReason>> = {
  LICENSE_RANGE_INVALID: 'rangeInvalid',
  LICENSE_TENANT_MISMATCH: 'tenantMismatch',
  TENANT_STATE_INVALID: 'tenantState',
  SIGNING_KEY_UNAVAILABLE: 'signingKey',
  LICENSE_STATE_INVALID: 'stateInvalid',
  VALIDATION_FAILED: 'invalid',
  INVALID_REQUEST: 'invalid',
  FIELD_NOT_ALLOWED: 'fieldNotAllowed',
  RESOURCE_NOT_FOUND: 'notFound',
  SCOPE_DENIED: 'denied',
  ENTITLEMENT_DENIED: 'denied',
};

// The field a code is about when the server names none.
const FIELD_BY_CODE: Readonly<Record<string, IssueField>> = {
  LICENSE_TENANT_MISMATCH: 'entitlement_version_id',
  TENANT_STATE_INVALID: 'tenant_id',
};

const isField = (value: string | undefined): value is IssueField => value !== undefined && (ISSUE_FIELDS as readonly string[]).includes(value);

/** Maps an error of a license command to what the screen shows; unknown failures become the general message. */
export function describeProblem(error: unknown): ProblemView {
  if (!(error instanceof ApiError)) return { reason: 'general', field: undefined, currentVersion: undefined };
  if (error.code === 'VERSION_CONFLICT') {
    const current = error.extensions.current_version;
    return { reason: 'conflict', field: undefined, currentVersion: typeof current === 'number' ? current : undefined };
  }
  if (error.code === 'MFA_REQUIRED') return { reason: 'stepUp', field: undefined, currentVersion: undefined };
  if (error.code === 'SESSION_EXPIRED') return { reason: 'session', field: undefined, currentVersion: undefined };
  return {
    reason: REASON_BY_CODE[error.code] ?? 'general',
    field: isField(error.detail) ? error.detail : FIELD_BY_CODE[error.code],
    currentVersion: undefined,
  };
}
