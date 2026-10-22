import { DomainError } from './errors.ts';

/**
 * Mass-assignment guard for request bodies: every own key of `body` must be in `allowed`.
 * Rejects with 400 FIELD_NOT_ALLOWED naming the offending keys (never their values) in body order;
 * a body that is not a plain object is 422 VALIDATION_FAILED.
 */
export function assertAllowedFields<T extends object>(body: unknown, allowed: readonly (keyof T & string)[]): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DomainError('VALIDATION_FAILED', 422);
  }
  const permitted = new Set<string>(allowed);
  const rejected = Object.keys(body).filter((key) => !permitted.has(key));
  if (rejected.length > 0) {
    throw new DomainError('FIELD_NOT_ALLOWED', 400, rejected.join(', '));
  }
}
