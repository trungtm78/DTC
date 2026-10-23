import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { UserSessionStore } from '@machvon/db';
import type { TenantDatabase } from '@machvon/db';
import { InMemorySpanExporter, traceIdOfCorrelation } from '@machvon/kernel';
import { bootstrap } from '../src/bootstrap';
import type { RunningApi } from '../src/bootstrap';
import { LocalTenantTokenIssuer, issuerKeyFromPem } from '../src/auth/tenant-token-issuer';
import { loadConfig } from '../src/config/config';
import type { Config } from '../src/config/config';
import type { ReadinessProbe } from '../src/health/health.controller';
import { AuthzHarness, TENANT_A, memberId, unitId } from '../../../packages/db/test/support/authz-fixtures';
import { ERROR_CODES_PATH } from './isolation/test-app';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'db', 'migrations');
const ISSUER = 'https://api.bootstrap.test';
const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const READER = 1;

describe('the real API bootstrap (ST-KERNEL-050)', () => {
  const harness = new AuthzHarness();
  const exporter = new InMemorySpanExporter();
  const running: RunningApi[] = [];
  const scratch: string[] = [];
  let baseEnv: Record<string, string>;
  let token: string;

  const configWith = (extra: Record<string, string> = {}): Config =>
    loadConfig({ ...baseEnv, ...extra }, { readText: () => pem });

  async function start(extra: Record<string, string> = {}, probe?: ReadinessProbe): Promise<RunningApi> {
    const api = await bootstrap(configWith(extra), { exporter, port: 0, ...(probe === undefined ? {} : { probe }) });
    running.push(api);
    return api;
  }

  const get = (api: RunningApi, path: string, headers: Record<string, string> = {}): Promise<Response> => fetch(`http://127.0.0.1:${api.port}${path}`, { headers });
  const authed = (extra: Record<string, string> = {}): Record<string, string> => ({ authorization: `Bearer ${token}`, ...extra });

  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [{ n: 1, path: `/${unitId(1)}/` }]);
    await harness.seedMembership(TENANT_A, READER, 1);
    await harness.seedRole(TENANT_A, 1, 'UNIT_READER', ['organization_unit.read'], 20);
    await harness.seedGrants(TENANT_A, [{ n: 1, member: READER, role: 1, kind: 'TENANT' }]);
    baseEnv = {
      DATABASE_URL_APP: harness.database.urlFor('machvon_app'),
      DATABASE_URL_CONTROL: harness.database.urlFor('machvon_control'),
      DATABASE_URL_OUTBOX_RELAY: harness.database.urlFor('machvon_outbox_relay'),
      OIDC_ISSUER: 'https://idp.bootstrap.test/realms/machvon',
      OIDC_JWKS_URI: 'https://idp.bootstrap.test/jwks',
      OIDC_IDENTITY_AUDIENCE: 'machvon-web',
      OIDC_CONTROL_AUDIENCE: 'machvon-control',
      TENANT_TOKEN_ISSUER: ISSUER,
      TENANT_TOKEN_SIGNING_KEY_PEM_PATH: 'unused-by-the-test-reader',
      TENANT_TOKEN_KEY_ID: 'k1',
      OUTBOX_SIGNING_KEY: Buffer.alloc(32, 9).toString('base64'),
      MIGRATIONS_DIR: MIGRATIONS,
      ERROR_CODES_PATH,
      SHUTDOWN_TIMEOUT_MS: '5000',
      CORS_ORIGINS: 'https://app.example.test',
    };
    // A live session of the reader, bound the way a tenant selection binds it, and a tenant token for it from the same key the API verifies with.
    const tenants = harness.tenants as TenantDatabase;
    const ctx = { tenantId: TENANT_A, membershipId: memberId(READER), scopeVersion: 1 };
    const userId = (await harness.owner<{ user_id: string }>(TENANT_A, [['select user_id from machvon.membership where id = $1', [ctx.membershipId]]]))[0]?.user_id as string;
    const bound = await tenants.withTenant(ctx, (tx) =>
      new UserSessionStore(tenants).bindInTx(tx, ctx, { userAccountId: userId, idpSessionId: randomUUID(), assurance: 'aal1', ipHash: 'h', userAgentSummary: 'jest' }),
    );
    const issuer = new LocalTenantTokenIssuer({ issuer: ISSUER, signingKey: issuerKeyFromPem(pem, 'k1') });
    token = (await issuer.issue({ tenant: ctx, sessionId: bound.id, assurance: 'aal1', mode: 'FULL', now: new Date() })).accessToken;
  }, 180_000);

  afterEach(async () => {
    exporter.spans.length = 0;
    while (running.length > 0) await running.pop()?.stop();
  });

  afterAll(async () => {
    for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
    await harness.stop();
  }, 60_000);

  describe('health', () => {
    it('answers live and ready without a token, ready only after the database answered and no migration is pending', async () => {
      const api = await start();
      expect((await get(api, '/health/live')).status).toBe(200);
      const ready = await get(api, '/health/ready');
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: 'ready', checks: { database: 'ok', migrations: 'ok' } });
    });

    it('is 503 not_ready when a migration of the code is not applied yet, while live stays 200', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'machvon-migrations-'));
      scratch.push(directory);
      cpSync(MIGRATIONS, directory, { recursive: true });
      writeFileSync(join(directory, 'V9999__not_applied_yet.sql'), 'select 1;');
      const api = await start({ MIGRATIONS_DIR: directory });
      const ready = await get(api, '/health/ready');
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ status: 'not_ready', checks: { database: 'ok', migrations: 'pending' }, pending_migrations: 1 });
      expect((await get(api, '/health/live')).status).toBe(200);
    });

    it('is 503 when the database does not answer, with no error text in the body, and live stays 200', async () => {
      const down: ReadinessProbe = { database: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2')), pendingMigrations: () => Promise.resolve([]) };
      const api = await start({}, down);
      const ready = await get(api, '/health/ready');
      expect(ready.status).toBe(503);
      const text = await ready.text();
      expect(JSON.parse(text)).toEqual({ status: 'not_ready', checks: { database: 'down', migrations: 'unknown' } });
      expect(text).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/);
      expect((await get(api, '/health/live')).status).toBe(200);
    });

    it('is 503 when the ledger cannot be read', async () => {
      const unreadable: ReadinessProbe = { database: () => Promise.resolve(), pendingMigrations: () => Promise.reject(new Error('permission denied for table schema_migration')) };
      const ready = await get(await start({}, unreadable), '/health/ready');
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({ checks: { database: 'ok', migrations: 'unknown' } });
    });
  });

  describe('the real guards', () => {
    it('refuses a request without a token and one with a token that is not ours', async () => {
      const api = await start();
      expect((await get(api, '/resources/organization_unit')).status).toBe(401);
      expect((await get(api, '/resources/organization_unit', { authorization: 'Bearer not.a.token' })).status).toBe(401);
    });

    it('serves the organisation unit reads (ADM-01) to a caller with a tenant token', async () => {
      const api = await start();
      const reply = await get(api, '/resources/organization_unit', authed());
      expect(reply.status).toBe(200);
      const body = (await reply.json()) as { items: Array<{ id: string }> };
      expect(body.items.map((item) => item.id)).toEqual([unitId(1)]);
    });

    it('answers a refusal as a problem document with the correlation id of the request', async () => {
      const api = await start();
      const reply = await get(api, '/resources/role_grant', authed({ 'x-correlation-id': '11111111-1111-4111-8111-111111111111' }));
      expect(reply.status).toBe(403);
      expect(reply.headers.get('x-correlation-id')).toBe('11111111-1111-4111-8111-111111111111');
      expect(reply.headers.get('content-type')).toContain('application/problem+json');
    });
  });

  describe('telemetry', () => {
    it('records one span per request with only allowlisted attributes, in the trace of the incoming traceparent', async () => {
      const api = await start();
      const traceId = '0af7651916cd43dd8448eb211c80319c';
      const reply = await get(api, '/resources/organization_unit?limit=5', authed({ traceparent: `00-${traceId}-b7ad6b7169203331-01` }));
      expect(reply.status).toBe(200);
      await new Promise((done) => setImmediate(done));
      const span = exporter.spans.find((candidate) => candidate.attributes.operation_id === 'get_resources_organization_unit');
      expect(span).toBeDefined();
      expect(span?.traceId).toBe(traceId);
      expect(span?.parentSpanId).toBe('b7ad6b7169203331');
      expect(span?.attributes).toEqual({
        tenant_id: TENANT_A,
        operation_id: 'get_resources_organization_unit',
        request_id: reply.headers.get('x-request-id'),
        correlation_id: reply.headers.get('x-correlation-id'),
        'http.status_code': 200,
      });
      expect(JSON.stringify(span)).not.toContain(token);
      // The correlation id (stored on the outbox row) names the same trace, so a consumer continues it.
      expect(traceIdOfCorrelation(reply.headers.get('x-correlation-id') as string)).toBe(traceId);
    });

    it('starts a new trace for a request without a traceparent and records a refusal with its status', async () => {
      const api = await start();
      const reply = await get(api, '/resources/organization_unit');
      expect(reply.status).toBe(401);
      await new Promise((done) => setImmediate(done));
      const span = exporter.spans.at(-1);
      expect(span?.attributes['http.status_code']).toBe(401);
      expect(span?.attributes).not.toHaveProperty('tenant_id');
      expect(span?.traceId).toBe(traceIdOfCorrelation(reply.headers.get('x-correlation-id') as string));
    });
  });

  describe('limits and cross-origin access', () => {
    it('refuses a body above the configured limit with 413, and lets the next request through', async () => {
      const api = await start({ MAX_BODY_BYTES: '1024' });
      const big = await fetch(`http://127.0.0.1:${api.port}/org-units`, {
        method: 'POST',
        headers: authed({ 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
        body: JSON.stringify({ name: 'x'.repeat(5000) }),
      });
      expect(big.status).toBe(413);
      expect((await get(api, '/health/live')).status).toBe(200);
    });

    it('allows the configured origin only', async () => {
      const api = await start();
      const allowed = await get(api, '/health/live', { origin: 'https://app.example.test' });
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.test');
      const other = await get(api, '/health/live', { origin: 'https://evil.example.test' });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
      expect(allowed.headers.get('x-powered-by')).toBeNull();
    });
  });

  describe('graceful shutdown', () => {
    it('finishes the request that is in flight and then refuses new connections', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((open) => {
        release = open;
      });
      const slow: ReadinessProbe = { database: () => gate, pendingMigrations: () => Promise.resolve([]) };
      const api = await start({}, slow);
      const inFlight = get(api, '/health/ready');
      await new Promise((wait) => setTimeout(wait, 100));
      const stopping = api.stop();
      await new Promise((wait) => setTimeout(wait, 100));
      release();
      const reply = await inFlight;
      expect(reply.status).toBe(200);
      await stopping;
      await expect(
        new Promise((accepted, refused) => {
          const socket = createConnection({ port: api.port, host: '127.0.0.1' }, () => {
            socket.destroy();
            accepted(true);
          });
          socket.on('error', refused);
        }),
      ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      await expect(api.stop()).resolves.toBeUndefined();
    });
  });
});
