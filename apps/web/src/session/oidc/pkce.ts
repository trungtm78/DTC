/** Source of random octets; tests inject fixed octets, the browser supplies its own generator. */
export type RandomOctets = () => Uint8Array;

const VERIFIER_OCTETS = 32;
const MIN_VERIFIER_CHARACTERS = 43;

function defaultRandom(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(VERIFIER_OCTETS));
}

/** Base64url without padding (RFC 4648 section 5). */
export function base64url(octets: Uint8Array): string {
  let binary = '';
  for (const octet of octets) binary += String.fromCharCode(octet);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The S256 code challenge of a verifier: base64url(SHA-256(ASCII(verifier))). */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/**
 * A fresh PKCE pair (RFC 7636): the verifier is 32 random octets in base64url (43 characters, the minimum the RFC
 * allows), the challenge its S256 transform. A generator that yields fewer octets is refused.
 */
export async function createPkcePair(random: RandomOctets = defaultRandom): Promise<PkcePair> {
  const verifier = base64url(random());
  if (verifier.length < MIN_VERIFIER_CHARACTERS) throw new Error('PKCE verifier is shorter than 43 characters');
  return { verifier, challenge: await challengeOf(verifier) };
}

/** An unguessable value for `state` and `nonce`. */
export function randomToken(random: RandomOctets = defaultRandom): string {
  return base64url(random());
}
