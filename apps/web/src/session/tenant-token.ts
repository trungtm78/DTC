const RENEW_LEAD_MS = 60_000;

/**
 * The claims of a compact JWT, read without checking the signature: the browser only needs `exp` to schedule a
 * renewal, and the API verifies every token it receives. Anything that is not a JWT with a JSON object payload is undefined.
 */
export function payloadOf(token: string): Record<string, unknown> | undefined {
  const segment = token.split('.')[1];
  if (segment === undefined || segment === '') return undefined;
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    // A malformed token is a normal input here (the caller treats it as "no expiry"), not a failure to report.
    return undefined;
  }
}

/** When the token expires, in epoch milliseconds, or undefined when it carries no usable `exp`. */
export function expiresAtMs(token: string): number | undefined {
  const exp = payloadOf(token)?.exp;
  return typeof exp === 'number' && Number.isInteger(exp) && exp > 0 ? exp * 1000 : undefined;
}

/** How long to wait before renewing a token: until `leadMs` before it expires, never negative. */
export function renewalDelayMs(expiresAt: number, now: number, leadMs: number = RENEW_LEAD_MS): number {
  return Math.max(0, expiresAt - leadMs - now);
}
