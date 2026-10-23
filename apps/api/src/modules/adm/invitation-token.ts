import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { asUuid } from '@machvon/kernel';

/** A pending invitation is valid for seven days (IAM section 3.3). */
export const INVITATION_TTL_DAYS = 7;

const TENANT_PART_BYTES = 16;
const SECRET_BYTES = 32;
const SECRET_PART_LENGTH = 43;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface InvitationToken {
  /** What the invited person receives; it is never stored. */
  token: string;
  /** SHA-256 of the token, in hex: the only form that is stored. */
  hash: string;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

function uuidOf(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A token is `<tenant>.<secret>`: the tenant id (not a secret) lets the accepting person's request find the right
 * tenant without any cross-tenant lookup, and the secret is 32 random bytes. Only the hash of the whole token is kept.
 */
export function createInvitationToken(tenantId: string, random: (size: number) => Buffer = randomBytes): InvitationToken {
  const tenant = asUuid(tenantId);
  if (tenant === undefined) throw new Error('invitation token needs a tenant id');
  const token = `${uuidBytes(tenant).toString('base64url')}.${random(SECRET_BYTES).toString('base64url')}`;
  return { token, hash: hashInvitationToken(token) };
}

/** The tenant a token names and its hash; undefined for anything that is not shaped like a token. */
export function parseInvitationToken(token: string): { tenantId: string; hash: string } | undefined {
  const parts = token.split('.');
  const [tenantPart, secretPart] = parts;
  if (parts.length !== 2 || tenantPart === undefined || secretPart === undefined) return undefined;
  if (!BASE64URL.test(tenantPart) || !BASE64URL.test(secretPart) || secretPart.length !== SECRET_PART_LENGTH) return undefined;
  const tenantBytes = Buffer.from(tenantPart, 'base64url');
  if (tenantBytes.length !== TENANT_PART_BYTES) return undefined;
  return { tenantId: uuidOf(tenantBytes), hash: hashInvitationToken(token) };
}

/** Compares two hex hashes without leaking where they differ. */
export function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** SHA-256 of an email as the invitation stores it: trimmed and lower-cased, so the comparison ignores case. */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
