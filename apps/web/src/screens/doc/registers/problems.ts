import { ApiError } from '@machvon/api-client';

/** Why a register or document type command failed, in the words of the DOC screens. */
export type ProblemReason =
  | 'conflict'
  | 'registerExists'
  | 'notOpen'
  | 'hasNumbered'
  | 'rangeOverlap'
  | 'patternInvalid'
  | 'invalid'
  | 'notFound'
  | 'denied'
  | 'session'
  | 'general';

export interface ProblemView {
  reason: ProblemReason;
  /** The server's name of the field the problem is about (`detail`), when it gave one. */
  field: string | undefined;
}

const REASON_BY_CODE: Readonly<Record<string, ProblemReason>> = {
  VERSION_CONFLICT: 'conflict',
  REGISTER_ALREADY_EXISTS: 'registerExists',
  REGISTER_NOT_OPEN: 'notOpen',
  REGISTER_HAS_OPEN_NUMBERED_DOCUMENTS: 'hasNumbered',
  DOC_TYPE_RANGE_OVERLAP: 'rangeOverlap',
  SYMBOL_PATTERN_INVALID: 'patternInvalid',
  VALIDATION_FAILED: 'invalid',
  INVALID_REQUEST: 'invalid',
  FIELD_NOT_ALLOWED: 'invalid',
  RESOURCE_NOT_FOUND: 'notFound',
  SCOPE_DENIED: 'denied',
  ENTITLEMENT_DENIED: 'denied',
  SESSION_EXPIRED: 'session',
};

/** Maps an error of a DOC command to what the screen shows; an unknown failure is the general message. */
export function describeProblem(error: unknown): ProblemView {
  if (!(error instanceof ApiError)) return { reason: 'general', field: undefined };
  return { reason: REASON_BY_CODE[error.code] ?? 'general', field: error.detail };
}
