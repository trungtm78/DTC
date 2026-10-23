import type { JsonWebKey } from 'node:crypto';
import { createPublicKey, verify } from 'node:crypto';
import { DomainError } from '@machvon/kernel';

/** The answer to every token that cannot be trusted: no detail, so nothing about the cause leaks. */
export function sessionExpired(): DomainError {
  return new DomainError('SESSION_EXPIRED', 401);
}

/** A token above this length is refused before it is parsed or any key is fetched. */
export const MAX_TOKEN_LENGTH = 8192;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export type JwtAlgorithm = 'RS256' | 'ES256';
/** The only algorithms ever accepted: never `none`, never an HMAC (algorithm confusion). */
export const ALLOWED_ALGORITHMS: readonly JwtAlgorithm[] = ['RS256', 'ES256'];

export interface ParsedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  algorithm: JwtAlgorithm;
  keyId: string;
  signingInput: Buffer;
  signature: Buffer;
}

function jsonObject(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw sessionExpired();
  return value as Record<string, unknown>;
}

function isAlgorithm(value: unknown): value is JwtAlgorithm {
  return typeof value === 'string' && (ALLOWED_ALGORITHMS as readonly string[]).includes(value);
}

/**
 * Splits and decodes a compact JWT without trusting anything in it. Anything that is not three base64url
 * segments, whose header does not name an allowed algorithm and a key id, is refused here.
 */
export function parseJwt(token: string): ParsedJwt {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw sessionExpired();
  const segments = token.split('.');
  if (segments.length !== 3) throw sessionExpired();
  const [head, body, tail] = segments as [string, string, string];
  if (!SEGMENT.test(head) || !SEGMENT.test(body) || !SEGMENT.test(tail)) throw sessionExpired();
  try {
    const header = jsonObject(head);
    const payload = jsonObject(body);
    const { alg, kid } = header;
    if (!isAlgorithm(alg) || typeof kid !== 'string' || kid === '' || kid.length > 256) throw sessionExpired();
    return { header, payload, algorithm: alg, keyId: kid, signingInput: Buffer.from(`${head}.${body}`), signature: Buffer.from(tail, 'base64url') };
  } catch (error) {
    throw error instanceof DomainError ? error : sessionExpired();
  }
}

/**
 * The audiences a token claims, read without verifying it: used only to choose which verification to run
 * (each verification then checks the audience again against the verified payload).
 */
export function peekAudiences(token: string): string[] {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return [];
  const body = token.split('.')[1];
  if (body === undefined || !SEGMENT.test(body)) return [];
  try {
    const { aud } = jsonObject(body);
    if (typeof aud === 'string') return [aud];
    return Array.isArray(aud) ? aud.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether a published key can verify tokens of this algorithm: key type, curve and `use` must all agree. */
export function keyMatches(jwk: JsonWebKey, algorithm: JwtAlgorithm): boolean {
  if (jwk.use !== undefined && jwk.use !== 'sig') return false;
  if (jwk.alg !== undefined && jwk.alg !== algorithm) return false;
  if (algorithm === 'RS256') return jwk.kty === 'RSA' && typeof jwk.n === 'string' && typeof jwk.e === 'string';
  return jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string';
}

/** Checks the signature of a parsed token against a published key; any failure is a refusal. */
export function verifySignature(parsed: ParsedJwt, jwk: JsonWebKey): boolean {
  if (!keyMatches(jwk, parsed.algorithm)) return false;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    return parsed.algorithm === 'RS256'
      ? verify('sha256', parsed.signingInput, key, parsed.signature)
      : verify('sha256', parsed.signingInput, { key, dsaEncoding: 'ieee-p1363' }, parsed.signature);
  } catch {
    return false;
  }
}

/** Time-based claims with the allowed clock skew; `exp` is required, `nbf` and `iat` only when present. */
export function checkTimes(payload: Record<string, unknown>, nowSeconds: number, skewSeconds: number): void {
  const { exp, nbf, iat } = payload;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) throw sessionExpired();
  if (nowSeconds > exp + skewSeconds) throw sessionExpired();
  if (nbf !== undefined && (typeof nbf !== 'number' || nowSeconds + skewSeconds < nbf)) throw sessionExpired();
  if (iat !== undefined && (typeof iat !== 'number' || nowSeconds + skewSeconds < iat)) throw sessionExpired();
}

/** The `aud` claim as a list of strings; anything else is no audience at all. */
export function audiencesOf(payload: Record<string, unknown>): string[] {
  const { aud } = payload;
  if (typeof aud === 'string') return [aud];
  return Array.isArray(aud) ? aud.filter((item): item is string => typeof item === 'string') : [];
}

const MFA_ACR = new Set(['aal2', '2']);
// RFC 8176 authentication method references grouped by the kind of factor they prove.
const FACTOR_KIND: Readonly<Record<string, 'knowledge' | 'possession' | 'inherence'>> = {
  pwd: 'knowledge',
  pin: 'knowledge',
  kba: 'knowledge',
  otp: 'possession',
  hwk: 'possession',
  swk: 'possession',
  sms: 'possession',
  tel: 'possession',
  fido: 'possession',
  webauthn: 'possession',
  bio: 'inherence',
  fpt: 'inherence',
  face: 'inherence',
  iris: 'inherence',
  retina: 'inherence',
  vbm: 'inherence',
};

/** An explicit `mfa` reference, or at least two different kinds of factor (never two factors of one kind). */
function usedSecondFactor(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  const methods = amr.filter((method): method is string => typeof method === 'string');
  if (methods.includes('mfa')) return true;
  const kinds = new Set(methods.map((method) => FACTOR_KIND[method]).filter((kind) => kind !== undefined));
  return kinds.size >= 2;
}

/**
 * `aal2` when `acr` says so or `amr` proves two independent kinds of factor (or says `mfa`), and only when the time of
 * authentication is known (a step-up window needs it); otherwise `aal1`. One factor, even a strong one, is `aal1`.
 */
export function assuranceOf(payload: Record<string, unknown>): { assurance: 'aal1' | 'aal2'; aal2At?: Date } {
  const { acr, amr, auth_time: authTime } = payload;
  const byAcr = typeof acr === 'string' && MFA_ACR.has(acr);
  if ((byAcr || usedSecondFactor(amr)) && typeof authTime === 'number' && Number.isFinite(authTime) && authTime > 0) {
    return { assurance: 'aal2', aal2At: new Date(authTime * 1000) };
  }
  return { assurance: 'aal1' };
}
