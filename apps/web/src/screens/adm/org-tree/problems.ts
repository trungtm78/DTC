import { ApiError } from '@machvon/api-client';
import { FORM_FIELDS } from './types';
import type { FormField } from './types';

/** Why a unit command failed, in the words of this screen (the server's own `error.<CODE>` keys are not in this catalogue). */
export type ProblemReason =
  | 'cycle'
  | 'depth'
  | 'codeTaken'
  | 'validity'
  | 'invalid'
  | 'fieldNotAllowed'
  | 'scopeDenied'
  | 'notFound'
  | 'conflict'
  | 'stepUp'
  | 'session'
  | 'general';

/** What the screen shows for a failed command: the reason and, when the server named one, the field it belongs to. */
export interface ProblemView {
  reason: ProblemReason;
  field: FormField | undefined;
  /** The version the server holds, for a conflict. */
  currentVersion: number | undefined;
  kind: 'field' | 'conflict' | 'stepUp' | 'session' | 'general';
}

const REASON_BY_CODE: Readonly<Record<string, ProblemReason>> = {
  UNIT_CYCLE: 'cycle',
  UNIT_DEPTH_EXCEEDED: 'depth',
  UNIT_CODE_TAKEN: 'codeTaken',
  UNIT_VALIDITY_INVALID: 'validity',
  VALIDATION_FAILED: 'invalid',
  INVALID_REQUEST: 'invalid',
  FIELD_NOT_ALLOWED: 'fieldNotAllowed',
  SCOPE_DENIED: 'scopeDenied',
  RESOURCE_NOT_FOUND: 'notFound',
};

// The field a code is about when the server names none.
const FIELD_BY_CODE: Readonly<Record<string, FormField>> = {
  UNIT_CYCLE: 'new_parent_id',
  UNIT_DEPTH_EXCEEDED: 'parent_id',
  UNIT_CODE_TAKEN: 'code',
  UNIT_VALIDITY_INVALID: 'valid_from',
};

const isFormField = (value: string | undefined): value is FormField => value !== undefined && (FORM_FIELDS as readonly string[]).includes(value);

const NO_FIELD = { field: undefined, currentVersion: undefined } as const;

/** Maps an error of a unit command to what the screen shows; unknown failures become the general message. */
export function describeProblem(error: unknown): ProblemView {
  if (!(error instanceof ApiError)) return { reason: 'general', kind: 'general', ...NO_FIELD };
  if (error.code === 'VERSION_CONFLICT') {
    const current = error.extensions.current_version;
    return { reason: 'conflict', kind: 'conflict', field: undefined, currentVersion: typeof current === 'number' ? current : undefined };
  }
  if (error.code === 'MFA_REQUIRED') return { reason: 'stepUp', kind: 'stepUp', ...NO_FIELD };
  if (error.code === 'SESSION_EXPIRED') return { reason: 'session', kind: 'session', ...NO_FIELD };
  const reason = REASON_BY_CODE[error.code] ?? 'general';
  const field = isFormField(error.detail) ? error.detail : FIELD_BY_CODE[error.code];
  return { reason, field, currentVersion: undefined, kind: field === undefined ? 'general' : 'field' };
}
