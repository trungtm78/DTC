import { sha256Hex } from '../src/canonical-json.ts';
import { DomainError } from '../src/errors.ts';
import {
  IDEMPOTENCY_LOCK_SECONDS,
  IDEMPOTENCY_TTL_HOURS,
  keyHashOf,
  parseIdempotencyKey,
  requestHashOf,
} from '../src/idempotency.ts';

function rejection(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

describe('parseIdempotencyKey', () => {
  it('accepts 16 and 128 visible ASCII characters', () => {
    expect(parseIdempotencyKey('a'.repeat(16))).toBe('a'.repeat(16));
    expect(parseIdempotencyKey('k-0123456789.abc:~')).toBe('k-0123456789.abc:~');
    expect(parseIdempotencyKey('a'.repeat(128))).toHaveLength(128);
  });

  it.each<[string, string | string[] | undefined]>([
    ['absent', undefined],
    ['15 characters', 'a'.repeat(15)],
    ['129 characters', 'a'.repeat(129)],
    ['a space', 'abcdefgh ijklmnop'],
    ['non-ASCII', 'abcdefghijklmnoĐ'],
    ['a control character', 'abcdefghijklmnop\n'],
    ['a repeated header', ['a'.repeat(16), 'b'.repeat(16)]],
  ])('rejects %s with 400 INVALID_REQUEST', (_label, header) => {
    const error = rejection(() => parseIdempotencyKey(header));
    expect(error.code).toBe('INVALID_REQUEST');
    expect(error.status).toBe(400);
    expect(error.detail).toBe('idempotency_key');
  });
});

describe('hashes', () => {
  it('hashes the key with sha256', () => {
    expect(keyHashOf('k'.repeat(16))).toBe(sha256Hex('k'.repeat(16)));
  });

  it('ignores key order but not values', () => {
    const base = { body: { a: 1, b: { c: 2, d: 3 } }, pathParams: { id: '1' }, ifMatch: null };
    expect(requestHashOf(base)).toBe(requestHashOf({ ...base, body: { b: { d: 3, c: 2 }, a: 1 } }));
    expect(requestHashOf(base)).not.toBe(requestHashOf({ ...base, body: { a: 1, b: { c: 2, d: 4 } } }));
  });

  it('separates a null If-Match from a present one and path params from each other', () => {
    const base = { body: { a: 1 }, pathParams: { id: '1' }, ifMatch: null as string | null };
    expect(requestHashOf(base)).not.toBe(requestHashOf({ ...base, ifMatch: '7' }));
    expect(requestHashOf({ ...base, ifMatch: '7' })).not.toBe(requestHashOf({ ...base, ifMatch: '8' }));
    expect(requestHashOf(base)).not.toBe(requestHashOf({ ...base, pathParams: { id: '2' } }));
  });

  it('hashes an absent body deterministically and distinguishes Vietnamese text', () => {
    const none = { body: undefined, pathParams: {}, ifMatch: null };
    expect(requestHashOf(none)).toBe(requestHashOf({ ...none }));
    expect(requestHashOf({ ...none, body: { city: 'Đà Nẵng' } })).not.toBe(requestHashOf({ ...none, body: { city: 'Da Nang' } }));
  });
});

describe('constants', () => {
  it('uses a 30 s lock and 72 h / 7 d TTLs', () => {
    expect(IDEMPOTENCY_LOCK_SECONDS).toBe(30);
    expect(IDEMPOTENCY_TTL_HOURS).toEqual({ standard: 72, extended: 168 });
  });
});
