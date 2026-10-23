import { ApiError } from '@machvon/api-client';

/** Why a verification failed, in the words of DOC-07. */
export type ProblemReason = 'notPdf' | 'scanPending' | 'invalid' | 'notFound' | 'denied' | 'session' | 'general';

export interface ProblemView {
  reason: ProblemReason;
}

const REASON_BY_CODE: Readonly<Record<string, ProblemReason>> = {
  DOCUMENT_VERSION_NOT_PDF: 'notPdf',
  SCAN_PENDING: 'scanPending',
  VALIDATION_FAILED: 'invalid',
  INVALID_REQUEST: 'invalid',
  FIELD_NOT_ALLOWED: 'invalid',
  RESOURCE_NOT_FOUND: 'notFound',
  SCOPE_DENIED: 'denied',
  ENTITLEMENT_DENIED: 'denied',
  SESSION_EXPIRED: 'session',
};

/** Maps the failure of a verification to what the screen shows; an unknown failure is the general message. */
export function describeProblem(error: unknown): ProblemView {
  if (!(error instanceof ApiError)) return { reason: 'general' };
  return { reason: REASON_BY_CODE[error.code] ?? 'general' };
}
