const MIN_KEY_BYTES = 32;
const DEFAULT_TTL_SECONDS = 300;
const encoder = new TextEncoder();

export interface DevTenantContext {
  tenantId: string;
  membershipId: string;
  scopeVersion: number;
  /** Assurance level of the session; the development API reads it as the `aal` claim. Omitted means not stated. */
  aal?: 'aal1' | 'aal2';
  /** When the session passed the second factor. */
  aal2At?: Date;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Signs a tenant context for the development API: `base64url(payload).base64url(hmac-sha256)`, the format of the
 * server-side signTenantContext. Development only; a real deployment signs in with OIDC instead (ST-IAM-002).
 * `keyBase64` must decode to at least 32 bytes.
 */
export async function signDevToken(
  context: DevTenantContext,
  keyBase64: string,
  now: () => number = nowSeconds,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const keyBytes = base64ToBytes(keyBase64);
  if (keyBytes.length < MIN_KEY_BYTES) throw new Error('The development session key must be at least 32 bytes');
  const payload = {
    tenantId: context.tenantId,
    membershipId: context.membershipId,
    scopeVersion: context.scopeVersion,
    exp: now() + ttlSeconds,
    ...(context.aal === undefined ? {} : { aal: context.aal }),
    ...(context.aal2At === undefined ? {} : { aal2At: context.aal2At.toISOString() }),
  };
  const payloadPart = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadPart)));
  return `${payloadPart}.${bytesToBase64Url(signature)}`;
}
