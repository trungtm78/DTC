import { DomainError, asUuid } from '@machvon/kernel';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** The ordering key of the last row of a page: rows come back ordered by (code, id). */
export interface PageAnchor {
  code: string;
  id: string;
}

export interface PageRequest {
  limit: number;
  after: PageAnchor | undefined;
}

const LIMIT_PATTERN = /^[1-9][0-9]{0,2}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

function invalid(field: 'limit' | 'cursor'): DomainError {
  return new DomainError('VALIDATION_FAILED', 422, field);
}

/** Opaque, URL-safe cursor: base64url of the JSON array [code, id] of the last row on the page. */
export function encodeCursor(anchor: PageAnchor): string {
  return Buffer.from(JSON.stringify([anchor.code, anchor.id]), 'utf8').toString('base64url');
}

function decodeCursor(value: unknown): PageAnchor {
  if (typeof value !== 'string' || !CURSOR_PATTERN.test(value)) throw invalid('cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalid('cursor');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw invalid('cursor');
  const [code, id] = parsed as unknown[];
  const uuid = asUuid(id);
  if (typeof code !== 'string' || uuid === undefined) throw invalid('cursor');
  const anchor = { code, id: uuid };
  // Only cursors this service issued are accepted: re-encoding must reproduce the input exactly.
  if (encodeCursor(anchor) !== value) throw invalid('cursor');
  return anchor;
}

/**
 * Validates the `limit` (1 to 200, default 50) and `cursor` query parameters. Anything malformed,
 * empty or repeated gives 422 VALIDATION_FAILED naming the parameter, never echoing its value.
 */
export function parsePageRequest(limit: unknown, cursor: unknown): PageRequest {
  let size = DEFAULT_LIMIT;
  if (limit !== undefined) {
    if (typeof limit !== 'string' || !LIMIT_PATTERN.test(limit) || Number(limit) > MAX_LIMIT) throw invalid('limit');
    size = Number(limit);
  }
  return { limit: size, after: cursor === undefined ? undefined : decodeCursor(cursor) };
}
