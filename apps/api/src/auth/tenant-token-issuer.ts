import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DomainError, parseTenantContext } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { TENANT_AUDIENCE, TENANT_TOKEN_TTL_SECONDS } from './claims';

export interface IssueInput {
  tenant: TenantContext;
  sessionId: string;
  assurance: 'aal1' | 'aal2';
  /** When the session last reached aal2 (required to carry the step-up window). */
  aal2At?: Date;
  mode: 'FULL' | 'READ_ONLY';
  now: Date;
}

export interface JsonWebKeySet {
  keys: JsonWebKey[];
}

/** The port that turns a verified selection of a tenant into an access token (a Keycloak exchange can replace it). */
export interface TenantTokenIssuer {
  issue(input: IssueInput): Promise<{ accessToken: string; expiresInSeconds: number }>;
  publicKeys(): Promise<JsonWebKeySet>;
}

/** An EC P-256 signing key: the private key, its id and the public JWK that is published. */
export interface IssuerKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: JsonWebKey;
}

export interface LocalTenantTokenIssuerOptions {
  issuer: string;
  audience?: string;
  /** The key that signs new tokens. */
  signingKey: IssuerKey;
  /** Keys that no longer sign but stay published while tokens signed with them may still be alive (rotation overlap). */
  retiredKeys?: readonly IssuerKey[];
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Builds an issuer key from a PEM private key; only EC P-256 keys are accepted (ES256). */
export function issuerKeyFromPem(pem: string, kid: string): IssuerKey {
  const privateKey = createPrivateKey(pem);
  const details = privateKey.asymmetricKeyDetails;
  if (privateKey.asymmetricKeyType !== 'ec' || details?.namedCurve !== 'prime256v1') {
    throw new Error('the tenant token signing key must be an EC P-256 private key');
  }
  const publicJwk = { ...createPublicKey(privateKey).export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
  return { kid, privateKey, publicJwk };
}

/**
 * Issues tenant access tokens (ES256, 5 minutes) with the claims of IAM 3.2: `sub`, `tid`, `mid`, `sv`, `sid`,
 * `aud`, `acr`/`amr` for the assurance level and `mode`. Two keys are published during a rotation.
 */
export class LocalTenantTokenIssuer implements TenantTokenIssuer {
  private readonly audience: string;

  constructor(private readonly options: LocalTenantTokenIssuerOptions) {
    this.audience = options.audience ?? TENANT_AUDIENCE;
  }

  issue(input: IssueInput): Promise<{ accessToken: string; expiresInSeconds: number }> {
    try {
      return Promise.resolve(this.sign(input));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('could not issue a token'));
    }
  }

  publicKeys(): Promise<JsonWebKeySet> {
    return Promise.resolve({ keys: [this.options.signingKey, ...(this.options.retiredKeys ?? [])].map((key) => key.publicJwk) });
  }

  private sign(input: IssueInput): { accessToken: string; expiresInSeconds: number } {
    // parseTenantContext rejects anything that is not a tenant id, a membership id and a scope version.
    const tenant = parseTenantContext(input.tenant);
    if (input.sessionId === '') throw new DomainError('VALIDATION_FAILED', 422, 'session');
    const issuedAt = Math.floor(input.now.getTime() / 1000);
    const second = input.assurance === 'aal2' && input.aal2At !== undefined;
    const payload = {
      iss: this.options.issuer,
      aud: this.audience,
      sub: tenant.membershipId,
      tid: tenant.tenantId,
      mid: tenant.membershipId,
      sv: tenant.scopeVersion,
      sid: input.sessionId,
      acr: second ? 'aal2' : 'aal1',
      amr: second ? ['pwd', 'otp'] : ['pwd'],
      ...(second ? { auth_time: Math.floor((input.aal2At as Date).getTime() / 1000) } : {}),
      mode: input.mode,
      iat: issuedAt,
      exp: issuedAt + TENANT_TOKEN_TTL_SECONDS,
    };
    const header = { alg: 'ES256', typ: 'JWT', kid: this.options.signingKey.kid };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signature = sign('sha256', Buffer.from(signingInput), { key: this.options.signingKey.privateKey, dsaEncoding: 'ieee-p1363' });
    return { accessToken: `${signingInput}.${base64url(signature)}`, expiresInSeconds: TENANT_TOKEN_TTL_SECONDS };
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

/**
 * Builds the issuer from the environment (names in .env.example): the PEM file of the signing key and its id, the
 * issuer name, and optionally one retired key during a rotation. Key material is never kept in the repository.
 */
export function issuerFromEnvironment(environment: Environment, read: (path: string) => string = (path) => readFileSync(path, 'utf8')): LocalTenantTokenIssuer {
  // Every required variable is checked before any file is read, so a missing name is reported as such.
  const signingPath = required(environment, 'TENANT_TOKEN_SIGNING_KEY_PEM_PATH');
  const keyId = required(environment, 'TENANT_TOKEN_KEY_ID');
  const issuer = required(environment, 'TENANT_TOKEN_ISSUER');
  const retiredPath = environment.TENANT_TOKEN_RETIRED_KEY_PEM_PATH;
  const hasRetired = retiredPath !== undefined && retiredPath !== '';
  const retiredId = hasRetired ? required(environment, 'TENANT_TOKEN_RETIRED_KEY_ID') : '';
  const signingKey = issuerKeyFromPem(read(signingPath), keyId);
  const retiredKeys = hasRetired ? [issuerKeyFromPem(read(retiredPath), retiredId)] : [];
  return new LocalTenantTokenIssuer({ issuer, signingKey, retiredKeys });
}
