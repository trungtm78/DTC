import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from './errors.ts';
import { parseTenantContext } from './tenant-context.ts';
import type { TenantContext } from './tenant-context.ts';

const MIN_KEY_BYTES = 32;
const DEFAULT_TTL_SECONDS = 300;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function invalid(): DomainError {
  return new DomainError('TENANT_CONTEXT_INVALID', 400);
}

function assertKey(key: Buffer): void {
  if (key.length < MIN_KEY_BYTES) {
    throw new Error('key too short');
  }
}

function mac(payloadPart: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(payloadPart).digest();
}

/**
 * Produces a compact `base64url(payload).base64url(hmac-sha256)` token that lets
 * a background worker re-establish a tenant context. Tokens expire after
 * `ttlSeconds` (default 300). The key must be at least 32 bytes.
 */
export function signTenantContext(
  ctx: TenantContext,
  key: Buffer,
  now: () => number = nowSeconds,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  assertKey(key);
  const { tenantId, membershipId, scopeVersion } = parseTenantContext(ctx);
  const payload = { tenantId, membershipId, scopeVersion, exp: now() + ttlSeconds };
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadPart}.${mac(payloadPart, key).toString('base64url')}`;
}

/**
 * Verifies a token from signTenantContext and returns its TenantContext. Any
 * malformed, tampered, mis-keyed or expired token throws
 * DomainError('TENANT_CONTEXT_INVALID', 400) without echoing token contents.
 */
export function verifyTenantContext(token: string, key: Buffer, now: () => number = nowSeconds): TenantContext {
  assertKey(key);
  const parts = token.split('.');
  const payloadPart = parts[0];
  const signaturePart = parts[1];
  if (parts.length !== 2 || !payloadPart || !signaturePart) {
    throw invalid();
  }

  const expected = mac(payloadPart, key);
  const actual = Buffer.from(signaturePart, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw invalid();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }

  let ctx: TenantContext;
  try {
    ctx = parseTenantContext(payload);
  } catch {
    throw invalid();
  }

  const exp = (payload as Record<string, unknown>).exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= now()) {
    throw invalid();
  }
  return ctx;
}
