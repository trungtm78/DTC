import { validateRequestBody } from '@machvon/contracts';
import type { Issue } from '@machvon/contracts';
import { DomainError } from '@machvon/kernel';

/**
 * Operations whose acceptance criteria answer a broken rule of a well typed value as 400 INVALID_REQUEST
 * (ST-ADM-005 AC-4: a custom role of rank 95 is 400). Every other operation answers 422 VALIDATION_FAILED.
 */
const RULE_AS_INVALID_REQUEST: ReadonlySet<string> = new Set(['createCustomRole', 'updateCustomRole', 'grantRole', 'revokeRoleGrant']);

/**
 * The problem for the issues of a request body, or undefined when there are none. The first class present wins:
 * unknown fields (400 FIELD_NOT_ALLOWED, all of them named), then a missing field or a wrong type (400
 * INVALID_REQUEST), then a broken rule (422 VALIDATION_FAILED). The detail names fields, never values.
 */
export function problemOf(issues: readonly Issue[], operationId: string): DomainError | undefined {
  const unknown = issues.filter((issue) => issue.kind === 'unknown_field');
  if (unknown.length > 0) return new DomainError('FIELD_NOT_ALLOWED', 400, unknown.map((issue) => issue.path).join(', '));
  const malformed = issues.find((issue) => issue.kind === 'missing' || issue.kind === 'type');
  if (malformed !== undefined) return new DomainError('INVALID_REQUEST', 400, malformed.path);
  const broken = issues.find((issue) => issue.kind === 'constraint');
  if (broken === undefined) return undefined;
  return RULE_AS_INVALID_REQUEST.has(operationId)
    ? new DomainError('INVALID_REQUEST', 400, broken.path)
    : new DomainError('VALIDATION_FAILED', 422, broken.path);
}

/**
 * Validates a command body against the request schema of its operation in openapi.json. Operations that are
 * not in the document (test routes) or that declare no JSON body are not checked.
 */
export function assertValidBody(operationId: string | undefined, body: unknown): void {
  if (operationId === undefined) return;
  const issues = validateRequestBody(operationId, body);
  if (issues === undefined) return;
  const problem = problemOf(issues, operationId);
  if (problem !== undefined) throw problem;
}
