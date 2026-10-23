import { assuranceOf, audiencesOf, checkTimes, keyMatches, parseJwt, peekAudiences } from '../../src/auth/jwt';
import { controlMembershipId, realmRoles, scopeVersionClaim, stringList } from '../../src/auth/claims';
import { base64url, newKey, signJwt } from './oidc-test-provider';

function unsigned(header: unknown, payload: unknown): string {
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}.${base64url('sig')}`;
}

describe('parseJwt', () => {
  it('reads the header, the payload and the signing input of a well-formed token', () => {
    const key = newKey('ES256', 'kid-1');
    const parsed = parseJwt(signJwt(key, { sub: 'a' }));
    expect(parsed).toMatchObject({ algorithm: 'ES256', keyId: 'kid-1', payload: { sub: 'a' } });
    expect(parsed.signature.length).toBe(64);
  });

  it.each([
    ['a header that is not an object', unsigned([], { a: 1 })],
    ['a payload that is not an object', unsigned({ alg: 'RS256', kid: 'k' }, [1])],
    ['an algorithm outside the allow-list', unsigned({ alg: 'HS256', kid: 'k' }, { a: 1 })],
    ['alg none', unsigned({ alg: 'none', kid: 'k' }, { a: 1 })],
    ['a missing key id', unsigned({ alg: 'RS256' }, { a: 1 })],
    ['an empty key id', unsigned({ alg: 'RS256', kid: '' }, { a: 1 })],
    ['a key id that is not text', unsigned({ alg: 'RS256', kid: 7 }, { a: 1 })],
    ['a key id of 300 characters', unsigned({ alg: 'RS256', kid: 'k'.repeat(300) }, { a: 1 })],
    ['a segment that is not JSON', `${base64url('{oops')}.${base64url('{}')}.${base64url('s')}`],
  ])('refuses %s with 401 SESSION_EXPIRED', (_label, token) => {
    expect(() => parseJwt(token)).toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED', status: 401 }));
  });
});

describe('peekAudiences', () => {
  const token = (aud: unknown): string => unsigned({ alg: 'RS256', kid: 'k' }, { aud });

  it('reads a single audience, a list and ignores entries that are not text', () => {
    expect(peekAudiences(token('a'))).toEqual(['a']);
    expect(peekAudiences(token(['a', 3, 'b']))).toEqual(['a', 'b']);
  });

  it.each([
    ['no audience', token(undefined)],
    ['an audience that is a number', token(5)],
    ['an empty token', ''],
    ['a token without a payload segment', 'abc'],
    ['a payload that is not base64url', 'a.!!!.c'],
    ['a payload that is not JSON', `a.${base64url('{oops')}.c`],
    ['an oversized token', 'a'.repeat(10_000)],
  ])('gives nothing for %s', (_label, value) => {
    expect(peekAudiences(value)).toEqual([]);
  });
});

describe('audiencesOf and the claim helpers', () => {
  it('reads string and array audiences', () => {
    expect(audiencesOf({ aud: 'a' })).toEqual(['a']);
    expect(audiencesOf({ aud: ['a', 1] })).toEqual(['a']);
    expect(audiencesOf({ aud: 4 })).toEqual([]);
    expect(audiencesOf({})).toEqual([]);
  });

  it('keeps string roles only, from realm_access', () => {
    expect(realmRoles({ realm_access: { roles: ['A', 2, 'B'] } })).toEqual(['A', 'B']);
    expect(realmRoles({ realm_access: 'x' })).toEqual([]);
    expect(realmRoles({})).toEqual([]);
    expect(stringList('nope')).toEqual([]);
  });

  it('accepts a scope version that is a non-negative safe integer only', () => {
    expect(scopeVersionClaim(0)).toBe(0);
    expect(scopeVersionClaim(7)).toBe(7);
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '1', null]) expect(scopeVersionClaim(bad)).toBeUndefined();
  });

  it('derives a stable UUID for a control subject, different for different subjects', () => {
    const one = controlMembershipId('subject-1');
    expect(one).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(controlMembershipId('subject-1')).toBe(one);
    expect(controlMembershipId('subject-2')).not.toBe(one);
  });
});

describe('checkTimes', () => {
  const now = 1_000_000;

  it('requires a numeric exp, and an nbf or iat that is a number when present', () => {
    expect(() => checkTimes({}, now, 30)).toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED' }));
    expect(() => checkTimes({ exp: '1' }, now, 30)).toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED' }));
    expect(() => checkTimes({ exp: Number.POSITIVE_INFINITY }, now, 30)).toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED' }));
    expect(() => checkTimes({ exp: now + 10, nbf: 'soon' }, now, 30)).toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED' }));
    expect(() => checkTimes({ exp: now + 10, iat: 'then' }, now, 30)).toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED' }));
    expect(() => checkTimes({ exp: now + 10, nbf: now - 5, iat: now - 5 }, now, 30)).not.toThrow();
  });
});

describe('keyMatches', () => {
  const rsa = newKey('RS256').publicJwk;
  const ec = newKey('ES256').publicJwk;

  it('pairs RS256 with RSA keys and ES256 with P-256 keys only', () => {
    expect(keyMatches(rsa, 'RS256')).toBe(true);
    expect(keyMatches(ec, 'ES256')).toBe(true);
    expect(keyMatches(rsa, 'ES256')).toBe(false);
    expect(keyMatches(ec, 'RS256')).toBe(false);
  });

  it('refuses a key restricted to another use, another algorithm, another curve or one that lacks its parameters', () => {
    expect(keyMatches({ ...rsa, use: 'enc' }, 'RS256')).toBe(false);
    expect(keyMatches({ ...rsa, alg: 'RS512' }, 'RS256')).toBe(false);
    expect(keyMatches({ ...ec, crv: 'P-384' }, 'ES256')).toBe(false);
    expect(keyMatches({ kty: 'RSA' }, 'RS256')).toBe(false);
    expect(keyMatches({ kty: 'EC', crv: 'P-256' }, 'ES256')).toBe(false);
  });
});

describe('assuranceOf', () => {
  it('needs a time of authentication to be aal2', () => {
    expect(assuranceOf({ acr: 'aal2', auth_time: 100 })).toEqual({ assurance: 'aal2', aal2At: new Date(100_000) });
    expect(assuranceOf({ acr: 'aal2' })).toEqual({ assurance: 'aal1' });
    expect(assuranceOf({ acr: 'aal2', auth_time: 0 })).toEqual({ assurance: 'aal1' });
    expect(assuranceOf({ amr: ['pwd', 'hwk'], auth_time: 5 })).toMatchObject({ assurance: 'aal2' });
    expect(assuranceOf({ amr: ['pwd'], auth_time: 5 })).toEqual({ assurance: 'aal1' });
    expect(assuranceOf({ amr: 'otp', auth_time: 5 })).toEqual({ assurance: 'aal1' });
  });
});
