import { createHmac, createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type TestAlg = 'RS256' | 'ES256';

export interface ProviderKey {
  kid: string;
  alg: TestAlg;
  privateKey: KeyObject;
  publicJwk: JsonWebKey & { kid: string; alg: string; use: string };
}

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function newKey(alg: TestAlg, kid: string = `kid-${randomUUID()}`): ProviderKey {
  const pair =
    alg === 'RS256'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' };
  return { kid, alg, privateKey: pair.privateKey, publicJwk };
}

/** Signs a compact JWT; `header` overrides the defaults (alg and kid of the key). */
export function signJwt(key: ProviderKey, payload: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const head = { alg: key.alg, typ: 'JWT', kid: key.kid, ...header };
  const input = `${base64url(JSON.stringify(head))}.${base64url(JSON.stringify(payload))}`;
  const signature =
    key.alg === 'RS256'
      ? sign('sha256', Buffer.from(input), key.privateKey)
      : sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${base64url(signature)}`;
}

/** A token with `alg: none` and an empty signature. */
export function unsecuredJwt(payload: Record<string, unknown>, kid = 'none'): string {
  return `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid }))}.${base64url(JSON.stringify(payload))}.`;
}

/** Algorithm confusion: HS256 keyed with the public key material that the JWKS publishes. */
export function hs256WithPublicKey(key: ProviderKey, payload: Record<string, unknown>): string {
  const head = { alg: 'HS256', typ: 'JWT', kid: key.kid };
  const input = `${base64url(JSON.stringify(head))}.${base64url(JSON.stringify(payload))}`;
  const secret = Buffer.from(JSON.stringify(key.publicJwk));
  return `${input}.${base64url(createHmac('sha256', secret).update(input).digest())}`;
}

/** Rebuilds a private key from a PEM (used by the issuer tests that load keys from a file). */
export function privateKeyFromPem(pem: string): KeyObject {
  return createPrivateKey(pem);
}

/**
 * An in-process OIDC provider: discovery and JWKS over real HTTP, so the adapter tests exercise real
 * fetching, caching and signature checks. Keys can be added, removed and rotated; the provider can go down.
 */
export class OidcTestProvider {
  readonly issuer: string;
  readonly jwksUri: string;
  jwksFetches = 0;
  discoveryFetches = 0;
  private readonly keys = new Map<string, ProviderKey>();
  private down = false;

  private constructor(
    private readonly server: Server,
    origin: string,
  ) {
    this.issuer = `${origin}/realms/machvon`;
    this.jwksUri = `${this.issuer}/protocol/openid-connect/certs`;
  }

  static async start(): Promise<OidcTestProvider> {
    const holder: { provider?: OidcTestProvider } = {};
    const server = createServer((request, response) => {
      const provider = holder.provider;
      if (provider === undefined || provider.down) {
        response.writeHead(503).end();
        return;
      }
      if (request.url === '/realms/machvon/.well-known/openid-configuration') {
        provider.discoveryFetches += 1;
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ issuer: provider.issuer, jwks_uri: provider.jwksUri }));
        return;
      }
      if (request.url === '/realms/machvon/protocol/openid-connect/certs') {
        provider.jwksFetches += 1;
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [...provider.keys.values()].map((key) => key.publicJwk) }));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    holder.provider = new OidcTestProvider(server, `http://127.0.0.1:${port}`);
    return holder.provider;
  }

  addKey(alg: TestAlg = 'RS256', kid?: string): ProviderKey {
    const key = newKey(alg, kid);
    this.keys.set(key.kid, key);
    return key;
  }

  removeKey(kid: string): void {
    this.keys.delete(kid);
  }

  /** Replaces every key by one new key (the old ones disappear from the JWKS at once). */
  rotate(alg: TestAlg = 'RS256'): ProviderKey {
    this.keys.clear();
    return this.addKey(alg);
  }

  setDown(down: boolean): void {
    this.down = down;
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
      this.server.closeAllConnections();
    });
  }
}
