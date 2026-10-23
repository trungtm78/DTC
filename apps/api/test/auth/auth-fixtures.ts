import { LocalTenantTokenIssuer } from '../../src/auth/tenant-token-issuer';
import type { IssuerKey } from '../../src/auth/tenant-token-issuer';
import { newKey } from './oidc-test-provider';
import type { ProviderKey } from './oidc-test-provider';

export const NOW = new Date('2026-10-23T10:00:00.000Z');
export const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
export const SUBJECT = '9b2c6f3e-5c1d-4a7e-8f21-0a1b2c3d4e5f';
export const SESSION_ID = 'idp-session-0001';
export const TENANT = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  membershipId: '00000000-0000-4000-8000-0000000000f1',
  scopeVersion: 7,
};
export const TENANT_ISSUER = 'https://api.machvon.test';
export const TENANT_AUDIENCE = 'machvon-api';
export const IDENTITY_AUDIENCE = 'machvon-web';
export const CONTROL_AUDIENCE = 'machvon-control';

export function issuerKey(key: ProviderKey = newKey('ES256')): IssuerKey {
  return { kid: key.kid, privateKey: key.privateKey, publicJwk: key.publicJwk };
}

export function newIssuer(signing: IssuerKey = issuerKey(), retired: readonly IssuerKey[] = []): LocalTenantTokenIssuer {
  return new LocalTenantTokenIssuer({ issuer: TENANT_ISSUER, signingKey: signing, retiredKeys: retired });
}

/** Claims of an identity token as an OIDC provider such as Keycloak issues them. */
export function identityClaims(issuer: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: issuer,
    aud: IDENTITY_AUDIENCE,
    sub: SUBJECT,
    sid: SESSION_ID,
    exp: NOW_SECONDS + 300,
    iat: NOW_SECONDS - 10,
    email: 'an@example.test',
    email_verified: true,
    acr: 'aal2',
    amr: ['pwd', 'otp'],
    auth_time: NOW_SECONDS - 60,
    ...overrides,
  };
}

export function controlClaims(issuer: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return identityClaims(issuer, { aud: CONTROL_AUDIENCE, realm_access: { roles: ['SystemAdmin'] }, ...overrides });
}

/** Claims of a tenant token as LocalTenantTokenIssuer writes them (for tokens with a deliberate flaw). */
export function tenantClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: TENANT_ISSUER,
    aud: TENANT_AUDIENCE,
    sub: TENANT.membershipId,
    tid: TENANT.tenantId,
    mid: TENANT.membershipId,
    sv: TENANT.scopeVersion,
    sid: SESSION_ID,
    acr: 'aal2',
    amr: ['pwd', 'otp'],
    auth_time: NOW_SECONDS - 60,
    mode: 'FULL',
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 300,
    ...overrides,
  };
}

/** Reads a nested member of a parsed JSON body (unknown when any step is missing). */
export function pick(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const step of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}
