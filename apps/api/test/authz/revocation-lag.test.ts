import { randomBytes, randomUUID } from 'node:crypto';
import { EffectiveAccessStore, InMemoryAuthzCache, TenantDatabase, seedSystemRoles } from '@machvon/db';
import { loadErrorRegistry, signTenantContext } from '@machvon/kernel';
import type { MetricsSink } from '@machvon/kernel';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { AuthzHarness, TENANT_A, contextFor, grantId, memberId } from '../../../../packages/db/test/support/authz-fixtures';
import { CLAIMS_HEADER, TENANT_HEADER } from '../isolation/test-auth.guard';
import { ERROR_CODES_PATH, startTestApp } from '../isolation/test-app';
import type { RunningApp } from '../isolation/test-app';
import { measureRevocationLag, percentile } from './revocation-lag';

const SIGNING_KEY = randomBytes(32);
const ACTOR = '00000000-0000-4000-8000-0000000000f0';
const ADMIN = 1;
const READER_ROLE = 70;
const FIRST_HOLDER = 100;
const FIRST_GRANT = 1000;
const REVOCATIONS = 100;
const LAG_BUDGET_SECONDS = 60;

class RecordingMetrics implements MetricsSink {
  readonly gauges: Array<{ name: string; value: number; labels: Record<string, string> }> = [];
  readonly counters = new Map<string, number>();

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = `${name}|${Object.entries(labels).sort().map(([k, v]) => `${k}=${v}`).join(',')}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauges.push({ name, value, labels });
  }
}

describe('measureRevocationLag', () => {
  it('takes the nearest-rank 95th percentile of sorted samples', () => {
    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(percentile(twenty, 0.95)).toBe(19);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([1, 2], 0.5)).toBe(1);
    expect(percentile(Array.from({ length: 100 }, (_, index) => index + 1), 0.95)).toBe(95);
    expect(() => percentile([], 0.95)).toThrow(RangeError);
  });

  it('times each subject from its revocation to its first refusal, using the injected clock', async () => {
    let clock = 0;
    const polls = new Map<number, number>();
    const lag = await measureRevocationLag({
      revocations: 3,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      intervalMs: 1000,
      revoke: () => Promise.resolve(),
      // Subject n is served n times before it is refused.
      isDenied: (index) => {
        const seen = (polls.get(index) ?? 0) + 1;
        polls.set(index, seen);
        return Promise.resolve(seen > index);
      },
    });
    expect(lag.samples).toEqual([0, 1, 2]);
    expect(lag.p95Seconds).toBe(2);
  });

  it('fails when a revoked subject is still served after the timeout', async () => {
    let clock = 0;
    await expect(
      measureRevocationLag({
        revocations: 1,
        timeoutSeconds: 5,
        intervalMs: 1000,
        now: () => clock,
        sleep: (ms) => {
          clock += ms;
          return Promise.resolve();
        },
        revoke: () => Promise.resolve(),
        isDenied: () => Promise.resolve(false),
      }),
    ).rejects.toThrow(/still served 5 seconds/);
  });

  it('uses the real clock and a default interval when none is injected', async () => {
    let denied = false;
    const lag = await measureRevocationLag({
      revocations: 1,
      intervalMs: 1,
      revoke: () => Promise.resolve(),
      isDenied: () => {
        const answer = denied;
        denied = true;
        return Promise.resolve(answer);
      },
    });
    expect(lag.samples).toHaveLength(1);
    expect(lag.p95Seconds).toBeLessThan(5);
  });
});

describe('revocation lag through the real application (UAT-AC119, BR-IAM-13)', () => {
  const harness = new AuthzHarness();
  const metrics = new RecordingMetrics();
  let app: RunningApp;
  let admin: Client;
  let lastBody = '';

  async function request(method: string, path: string, member: number, extra: { ifMatch?: string; aal2?: boolean; body?: unknown } = {}): Promise<number> {
    // Every holder keeps presenting a token with scope_version 1, the value from before the revocation.
    const headers: Record<string, string> = {
      [TENANT_HEADER]: signTenantContext(contextFor(TENANT_A, memberId(member), 1), SIGNING_KEY),
      'content-type': 'application/json',
    };
    if (extra.aal2 === true) headers[CLAIMS_HEADER] = JSON.stringify({ aal: 'aal2', aal2At: new Date().toISOString() });
    if (method !== 'GET') headers['idempotency-key'] = `key-${randomUUID()}`;
    if (extra.ifMatch !== undefined) headers['if-match'] = extra.ifMatch;
    const response = await fetch(`${app.baseUrl}${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(extra.body ?? {}) });
    lastBody = await response.text();
    return response.status;
  }

  beforeAll(async () => {
    await harness.start();
    admin = new Client({ connectionString: harness.database.adminUrl });
    await admin.connect();
    await harness.seedUnits(TENANT_A, [{ n: 1, path: '/u1/' }]);
    await harness.tenants.withTenant(contextFor(TENANT_A, memberId(ADMIN)), (tx) => seedSystemRoles(tx, ACTOR));
    await harness.seedMembership(TENANT_A, ADMIN, 1);
    const adminRole = (await admin.query<{ id: string }>("select id from machvon.role_definition where tenant_id = $1 and code = 'TENANT_ADMIN'", [TENANT_A])).rows[0]?.id;
    await harness.owner(TENANT_A, [
      [
        `insert into machvon.role_grant (tenant_id, id, membership_id, role_id, scope_json, effective_from, scope_kind, scope_ref_ids, status, granted_by, grant_reason)
         values ($1, $2, $3, $4, '{"kind":"TENANT","ref_ids":[]}'::jsonb, '2026-01-01T00:00:00Z', 'TENANT', '{}', 'Active', $5, 'lag')`,
        [TENANT_A, grantId(1), memberId(ADMIN), adminRole, ACTOR],
      ],
    ]);
    await harness.seedRole(TENANT_A, READER_ROLE, 'GRANT_READER', ['role_grant.read'], 30);
    for (let index = 0; index < REVOCATIONS; index += 1) await harness.seedMembership(TENANT_A, FIRST_HOLDER + index, 1);
    await harness.seedGrants(
      TENANT_A,
      Array.from({ length: REVOCATIONS }, (_, index) => ({ n: FIRST_GRANT + index, member: FIRST_HOLDER + index, role: READER_ROLE, kind: 'TENANT' as const })),
    );
    const database = new TenantDatabase(harness.appPool);
    app = await startTestApp({
      signingKey: SIGNING_KEY,
      imports: [
        AppModule.register({
          database,
          registry: loadErrorRegistry(ERROR_CODES_PATH),
          policy: { database, access: new EffectiveAccessStore(database, new InMemoryAuthzCache()), metrics },
        }),
      ],
    });
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
    await admin?.end();
    await harness.stop();
  }, 60_000);

  it('refuses a token with the old scope_version right after each of 100 revocations, p95 well within 60 seconds', async () => {
    const servedBefore: number[] = [];
    const lag = await measureRevocationLag({
      revocations: REVOCATIONS,
      async revoke(index) {
        const holder = FIRST_HOLDER + index;
        servedBefore.push(await request('GET', '/resources/role_grant', holder));
        const status = await request('POST', `/role-grants/${grantId(FIRST_GRANT + index)}/revoke`, ADMIN, {
          aal2: true,
          ifMatch: '"1"',
          body: { reason: 'revocation lag measurement' },
        });
        if (status !== 200) throw new Error(`revocation ${index} answered ${status}: ${lastBody}`);
      },
      async isDenied(index) {
        return (await request('GET', '/resources/role_grant', FIRST_HOLDER + index)) === 403;
      },
    });

    expect(servedBefore).toHaveLength(REVOCATIONS);
    expect(servedBefore.every((status) => status === 200)).toBe(true);
    expect(lag.samples).toHaveLength(REVOCATIONS);
    expect(lag.p95Seconds).toBeLessThanOrEqual(LAG_BUDGET_SECONDS);

    for (const sample of lag.samples) metrics.gauge('access_revocation_lag_seconds', sample, { stat: 'sample' });
    metrics.gauge('access_revocation_lag_seconds', lag.p95Seconds, { stat: 'p95' });
    const recorded = metrics.gauges.filter((gauge) => gauge.name === 'access_revocation_lag_seconds');
    expect(recorded).toHaveLength(REVOCATIONS + 1);
    expect(recorded.at(-1)).toEqual({ name: 'access_revocation_lag_seconds', value: lag.p95Seconds, labels: { stat: 'p95' } });
    // The guard counted the refusals it made while polling.
    const denied = [...metrics.counters.entries()].filter(([key]) => key.startsWith('authz_decision_total|') && key.includes('outcome=deny'));
    expect(denied.reduce((sum, [, count]) => sum + count, 0)).toBeGreaterThanOrEqual(REVOCATIONS);
  }, 300_000);
});
