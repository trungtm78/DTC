import { canonicalJson, sha256Hex } from './canonical-json.ts';
import { DomainError } from './errors.ts';

export type IdempotencyTtl = 'standard' | 'extended';

/** Lock held by the request that owns an `IN_PROGRESS` record (BR-PLT-02). */
export const IDEMPOTENCY_LOCK_SECONDS = 30;

/** 72 hours for every command, 7 days for money and offline-mobile commands. */
export const IDEMPOTENCY_TTL_HOURS: Readonly<Record<IdempotencyTtl, number>> = { standard: 72, extended: 168 };

const KEY_PATTERN = /^[\x21-\x7E]{16,128}$/;

/** The `Idempotency-Key` header: 16 to 128 visible ASCII characters, exactly one value. */
export function parseIdempotencyKey(header: string | string[] | undefined): string {
  if (typeof header !== 'string' || !KEY_PATTERN.test(header)) {
    throw new DomainError('INVALID_REQUEST', 400, 'idempotency_key');
  }
  return header;
}

export function keyHashOf(key: string): string {
  return sha256Hex(key);
}

export interface RequestParts {
  body: unknown;
  pathParams: Record<string, string>;
  ifMatch: string | null;
}

/** sha256 of the canonical JSON of body, path params and the raw If-Match value (BR-PLT-02). */
export function requestHashOf(parts: RequestParts): string {
  return sha256Hex(canonicalJson({ body: parts.body ?? null, path_params: parts.pathParams, if_match: parts.ifMatch }));
}
