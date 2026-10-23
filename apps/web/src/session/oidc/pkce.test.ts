import { describe, expect, it } from 'vitest';
import { challengeOf, createPkcePair, randomToken } from './pkce';

// RFC 7636 appendix B: the octets of the sample verifier and the S256 challenge the RFC gives for it.
const RFC_OCTETS = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe('PKCE (RFC 7636)', () => {
  it('reproduces the verifier and the S256 challenge of RFC 7636 appendix B', async () => {
    const pair = await createPkcePair(() => Uint8Array.from(RFC_OCTETS));
    expect(pair.verifier).toBe(RFC_VERIFIER);
    expect(pair.challenge).toBe(RFC_CHALLENGE);
    expect(await challengeOf(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('makes a verifier of 43 base64url characters without padding from the default random source', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(BASE64URL);
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(BASE64URL);
  });

  it('never repeats a verifier', async () => {
    const seen = new Set<string>();
    for (let n = 0; n < 50; n += 1) seen.add((await createPkcePair()).verifier);
    expect(seen.size).toBe(50);
  });

  it('refuses a random source that returns too few octets (a verifier shorter than 43 characters)', async () => {
    await expect(createPkcePair(() => new Uint8Array(16))).rejects.toThrow('PKCE verifier');
  });

  it('makes state and nonce values of base64url characters', () => {
    expect(randomToken()).toMatch(BASE64URL);
    expect(randomToken()).not.toBe(randomToken());
  });
});
