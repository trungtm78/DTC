import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { UserSessionStore } from '@machvon/db';
import type { TenantDatabase } from '@machvon/db';
import { LocalTenantTokenIssuer, issuerKeyFromPem } from '../../src/auth/tenant-token-issuer';
import { loadConfig } from '../../src/config/config';
import type { Config } from '../../src/config/config';
import { AuthzHarness, TENANT_A, memberId, unitId } from '../../../../packages/db/test/support/authz-fixtures';
import { ERROR_CODES_PATH } from '../isolation/test-app';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
export const MIGRATIONS = join(REPO_ROOT, 'db', 'migrations');
export const TENANT_TOKEN_ISSUER = 'https://api.bootstrap.test';
export const READER = 1;
const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

export interface BootstrapFixture {
  harness: AuthzHarness;
  /** The environment of a complete configuration that points at the test database. */
  baseEnv: Record<string, string>;
  /** A tenant token of a live session of the reader (member 1 of tenant A). */
  token: string;
  configWith(extra?: Record<string, string>): Config;
  stop(): Promise<void>;
}

/**
 * The database, the reader and the environment every test of the real API bootstrap needs: tenant A with one unit, one
 * member holding `permissions` on the whole tenant, a live session bound the way a tenant selection binds it, and a
 * tenant token for it from the key the API verifies with.
 */
export async function startBootstrapFixture(permissions: readonly string[] = ['organization_unit.read']): Promise<BootstrapFixture> {
  const harness = new AuthzHarness();
  await harness.start();
  await harness.seedUnits(TENANT_A, [{ n: 1, path: `/${unitId(1)}/` }]);
  await harness.seedMembership(TENANT_A, READER, 1);
  await harness.seedRole(TENANT_A, 1, 'FIXTURE_ROLE', permissions, 20);
  await harness.seedGrants(TENANT_A, [{ n: 1, member: READER, role: 1, kind: 'TENANT' }]);
  const baseEnv: Record<string, string> = {
    DATABASE_URL_APP: harness.database.urlFor('machvon_app'),
    DATABASE_URL_CONTROL: harness.database.urlFor('machvon_control'),
    DATABASE_URL_OUTBOX_RELAY: harness.database.urlFor('machvon_outbox_relay'),
    OIDC_ISSUER: 'https://idp.bootstrap.test/realms/machvon',
    OIDC_JWKS_URI: 'https://idp.bootstrap.test/jwks',
    OIDC_IDENTITY_AUDIENCE: 'machvon-web',
    OIDC_CONTROL_AUDIENCE: 'machvon-control',
    TENANT_TOKEN_ISSUER,
    TENANT_TOKEN_SIGNING_KEY_PEM_PATH: 'unused-by-the-test-reader',
    TENANT_TOKEN_KEY_ID: 'k1',
    OUTBOX_SIGNING_KEY: Buffer.alloc(32, 9).toString('base64'),
    MIGRATIONS_DIR: MIGRATIONS,
    ERROR_CODES_PATH,
    SHUTDOWN_TIMEOUT_MS: '5000',
    CORS_ORIGINS: 'https://app.example.test',
  };
  const tenants = harness.tenants as TenantDatabase;
  const ctx = { tenantId: TENANT_A, membershipId: memberId(READER), scopeVersion: 1 };
  const userId = (await harness.owner<{ user_id: string }>(TENANT_A, [['select user_id from machvon.membership where id = $1', [ctx.membershipId]]]))[0]?.user_id as string;
  const bound = await tenants.withTenant(ctx, (tx) =>
    new UserSessionStore(tenants).bindInTx(tx, ctx, { userAccountId: userId, idpSessionId: randomUUID(), assurance: 'aal1', ipHash: 'h', userAgentSummary: 'jest' }),
  );
  const issuer = new LocalTenantTokenIssuer({ issuer: TENANT_TOKEN_ISSUER, signingKey: issuerKeyFromPem(pem, 'k1') });
  const token = (await issuer.issue({ tenant: ctx, sessionId: bound.id, assurance: 'aal1', mode: 'FULL', now: new Date() })).accessToken;
  return {
    harness,
    baseEnv,
    token,
    configWith: (extra = {}) => loadConfig({ ...baseEnv, ...extra }, { readText: () => pem }),
    stop: () => harness.stop(),
  };
}
