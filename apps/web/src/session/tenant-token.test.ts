import { describe, expect, it } from 'vitest';
import { expiresAtMs, payloadOf, renewalDelayMs } from './tenant-token';

function jwt(payload: unknown): string {
  const part = (value: unknown): string =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(payload)}.signature`;
}

describe('payloadOf', () => {
  it('reads the claims of a compact JWT without verifying it (the API verifies every token)', () => {
    expect(payloadOf(jwt({ sub: 'u1', exp: 100, name: 'Đà Nẵng' }))).toEqual({ sub: 'u1', exp: 100, name: 'Đà Nẵng' });
  });

  it.each([['an empty token', ''], ['one segment', 'abc'], ['a payload that is not base64url JSON', 'a.@@@.c'], ['a payload that is a JSON array', jwt([1, 2])], ['a payload that is JSON null', jwt(null)]])(
    'returns undefined for %s',
    (_label, token) => {
      expect(payloadOf(token)).toBeUndefined();
    },
  );
});

describe('expiresAtMs', () => {
  it('turns the exp claim (seconds) into milliseconds', () => {
    expect(expiresAtMs(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });

  it.each([['no exp', {}], ['a text exp', { exp: '1800000000' }], ['a negative exp', { exp: -1 }], ['a fractional exp', { exp: 1.5 }]])('returns undefined for %s', (_label, claims) => {
    expect(expiresAtMs(jwt(claims))).toBeUndefined();
  });
});

describe('renewalDelayMs', () => {
  const now = 1_000_000;

  it('renews one minute before the token expires by default', () => {
    expect(renewalDelayMs(now + 300_000, now)).toBe(240_000);
  });

  it('honours a custom lead time', () => {
    expect(renewalDelayMs(now + 300_000, now, 30_000)).toBe(270_000);
  });

  it('renews at once when the token expires inside the lead time or has expired', () => {
    expect(renewalDelayMs(now + 30_000, now)).toBe(0);
    expect(renewalDelayMs(now - 1, now)).toBe(0);
  });
});
