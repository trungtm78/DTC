import { DomainError } from './errors.ts';

const VERSION_TEXT = /^\d+$/;

function invalid(): DomainError {
  return new DomainError('INVALID_REQUEST', 400, 'if_match');
}

/**
 * The integer version carried by `If-Match` (`"7"`, `W/"7"` or `7`). An absent header is 428
 * PRECONDITION_REQUIRED; anything that is not a non-negative safe integer is 400 INVALID_REQUEST.
 */
export function parseIfMatch(header: string | string[] | undefined): number {
  if (header === undefined) throw new DomainError('PRECONDITION_REQUIRED', 428, 'if_match');
  if (typeof header !== 'string') throw invalid();
  const bare = header.trim().replace(/^W\//, '');
  const text = bare.startsWith('"') && bare.endsWith('"') && bare.length >= 2 ? bare.slice(1, -1) : bare;
  const version = VERSION_TEXT.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(version)) throw invalid();
  return version;
}

/** The strong ETag for a record version. */
export function formatEtag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 0) throw new RangeError('version must be a non-negative safe integer');
  return `"${version}"`;
}

/** 409 VERSION_CONFLICT with the current version and, optionally, an already redacted diff. */
export function versionConflict(currentVersion: number, safeDiff?: Record<string, unknown>): DomainError {
  const extensions: Record<string, unknown> = { current_version: currentVersion };
  if (safeDiff !== undefined) extensions.safe_diff = safeDiff;
  return new DomainError('VERSION_CONFLICT', 409, undefined, { extensions });
}
