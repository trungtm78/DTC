import { ApiError } from '@machvon/api-client';

/** Why a signing or numbering command failed, in the words of DOC-05 and DOC-06. */
export type ProblemReason =
  | 'conflict'
  | 'selfSign'
  | 'notSigner'
  | 'certificate'
  | 'sessionOpen'
  | 'pending'
  | 'expired'
  | 'adapter'
  | 'provider'
  | 'digest'
  | 'signature'
  | 'state'
  | 'registerNotOpen'
  | 'registerYear'
  | 'lockTimeout'
  | 'leaderBroken'
  | 'incremental'
  | 'symbol'
  | 'invalid'
  | 'notFound'
  | 'denied'
  | 'session'
  | 'general';

/** The command the failure belongs to: the same code (a session that is open) means another thing when completing. */
export type ProblemContext = 'start' | 'complete' | 'number';

export interface ProblemView {
  reason: ProblemReason;
  /** The server's name of the field the problem is about (`detail`), when it gave one. */
  field: string | undefined;
}

const REASON_BY_CODE: Readonly<Record<string, ProblemReason>> = {
  VERSION_CONFLICT: 'conflict',
  SELF_APPROVAL_DENIED: 'selfSign',
  SIGNER_NOT_AUTHORIZED: 'notSigner',
  CERTIFICATE_NOT_ACTIVE: 'certificate',
  SIGNING_SESSION_EXPIRED: 'expired',
  SIGNING_ADAPTER_UNAVAILABLE: 'adapter',
  PROVIDER_UNAVAILABLE: 'provider',
  DIGEST_MISMATCH: 'digest',
  SIGNATURE_INVALID: 'signature',
  DOCUMENT_STATE_INVALID: 'state',
  NUMBERING_BEFORE_SIGNATURE: 'state',
  REGISTER_NOT_OPEN: 'registerNotOpen',
  REGISTER_YEAR_MISMATCH: 'registerYear',
  REGISTER_LOCK_TIMEOUT: 'lockTimeout',
  LEADER_SIGNATURE_BROKEN: 'leaderBroken',
  INCREMENTAL_UPDATE_FAILED: 'incremental',
  SYMBOL_PATTERN_INVALID: 'symbol',
  SYMBOL_FORMAT_INVALID: 'symbol',
  VALIDATION_FAILED: 'invalid',
  INVALID_REQUEST: 'invalid',
  FIELD_NOT_ALLOWED: 'invalid',
  RESOURCE_NOT_FOUND: 'notFound',
  SCOPE_DENIED: 'denied',
  ENTITLEMENT_DENIED: 'denied',
  SESSION_EXPIRED: 'session',
};

/** Maps the failure of a command to what the screen shows; an unknown failure is the general message. */
export function describeProblem(error: unknown, context: ProblemContext): ProblemView {
  if (!(error instanceof ApiError)) return { reason: 'general', field: undefined };
  if (error.code === 'SIGNING_SESSION_OPEN') return { reason: context === 'complete' ? 'pending' : 'sessionOpen', field: error.detail };
  return { reason: REASON_BY_CODE[error.code] ?? 'general', field: error.detail };
}
