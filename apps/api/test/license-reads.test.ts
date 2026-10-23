import { randomBytes } from 'node:crypto';
import { EffectiveAccessStore, InMemoryAuthzCache, LicenseStore, EntitlementStore, InMemoryEntitlementCache } from '@machvon/db';
import { seedSystemRoles } from '@machvon/db/src/system-roles';
import { loadErrorRegistry, signTenantContext } from '@machvon/kernel';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import type { LicenseKeyStore } from '../src/modules/sas/license-signer';
import { AuthzHarness, ACTOR, TENANT_A, TENANT_B, contextFor, memberId } from '../../../packages/db/test/support/authz-fixtures';
import { CLAIMS_HEADER, TENANT_HEADER } from './isolation/test-auth.guard';
import { ERROR_CODES_PATH, startTestApp } from './isolation/test-app';
import type { RunningApp } from './isolation/test-app';

const SIGNING_KEY = randomBytes(32);
const READER = 1;
const OUTSIDER = 2;
const DAY_MS = 86_400_000;
const ids = { active: '00000000-0000-4000-b100-000000000001', grace: '00000000-0000-4000-b100-000000000002', revoked: '00000000-0000-4000-b100-000000000003', suspended: '00000000-0000-4000-b100-000000000004', superseded: '00000000-0000-4000-b100-000000000005', otherTenant: '00000000-0000-4000-b100-000000000006' };

interface Reply {
  status: number;
  json: Record<string, unknown>;
}

describe('license reads of the tenant plane (get_resources_license_revision)', () => {
  const harness = new AuthzHarness();
  let app: RunningApp;
  const at = (days: number): string => new Date(Date.now() + days * DAY_MS).toISOString();

  async function call(path: string, options: { member?: number; tenant?: string; audience?: string; roles?: string[] } = {}): Promise<Reply> {
    const token = signTenantContext(contextFor(options.tenant ?? TENANT_A, memberId(options.member ?? READER)), SIGNING_KEY);
    const headers: Record<string, string> = { [TENANT_HEADER]: token };
    if (options.audience !== undefined) headers[CLAIMS_HEADER] = JSON.stringify({ aud: options.audience, roles: options.roles ?? [] });
    const response = await fetch(`${app.baseUrl}${path}`, { headers });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  async function seedLicense(tenant: string, id: string, serial: string, revision: number, status: string, from: number, until: number, grace: number): Promise<void> {
    const client = new Client({ connectionString: harness.database.adminUrl });
    await client.connect();
    try {
      await client.query('begin');
      // Superuser seeding: the foreign keys point at a signing key and an entitlement version the test does not need.
      await client.query("set local session_replication_role = 'replica'");
      await client.query(
        `insert into machvon.license_revision (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, status_reason, signed_claims, key_id, edition, seats, issued_at)
         values ($1, $2, $3, $4, gen_random_uuid(), $5, $6, $7, $8, $9, 'secret.signed.claims', 'kid-secret', 'STANDARD', 20, now())`,
        [tenant, id, serial, revision, at(from), at(until), at(grace), status, status === 'Revoked' || status === 'Suspended' ? 'Decided by the system administrator.' : null],
      );
      await client.query('commit');
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await harness.start();
    for (const tenant of [TENANT_A, TENANT_B]) {
      await harness.seedUnits(tenant, [{ n: 1, path: '/u1/' }]);
      await harness.tenants.withTenant(contextFor(tenant, memberId(READER)), (tx) => seedSystemRoles(tx, ACTOR));
      await harness.seedMembership(tenant, READER, 1);
      await harness.seedMembership(tenant, OUTSIDER, 1);
      await harness.seedRole(tenant, 70, 'LICENSE_READER', ['license_revision.read'], 10);
      await harness.seedGrants(tenant, [{ n: 1, member: READER, role: 70, kind: 'TENANT' }]);
    }
    await seedLicense(TENANT_A, ids.superseded, 'LIC-1', 1, 'Superseded', -400, -35, -5);
    await seedLicense(TENANT_A, ids.active, 'LIC-1', 2, 'Active', -35, 20, 50);
    await seedLicense(TENANT_A, ids.grace, 'LIC-2', 1, 'Grace', -400, -10, 20);
    await seedLicense(TENANT_A, ids.revoked, 'LIC-3', 1, 'Revoked', -10, 300, 330);
    await seedLicense(TENANT_A, ids.suspended, 'LIC-4', 1, 'Suspended', -10, 300, 330);
    await seedLicense(TENANT_B, ids.otherTenant, 'LIC-1', 1, 'Active', -10, 300, 330);
    const keys: LicenseKeyStore = { current: () => Promise.reject(new Error('unused')), publicKeys: () => Promise.resolve(new Map()) };
    const entitlements = new EntitlementStore(harness.tenants, new InMemoryEntitlementCache());
    app = await startTestApp({
      signingKey: SIGNING_KEY,
      imports: [
        AppModule.register({
          database: harness.tenants,
          registry: loadErrorRegistry(ERROR_CODES_PATH),
          policy: { database: harness.tenants, access: new EffectiveAccessStore(harness.tenants, new InMemoryAuthzCache()) },
          licenses: { store: new LicenseStore(entitlements), keys },
        }),
      ],
    });
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
    await harness.stop();
  }, 60_000);

  it('lists the licenses of the own tenant by serial and revision, with the state the clock and the labels give, and no claims or key', async () => {
    const reply = await call('/resources/license_revision');
    expect(reply.status).toBe(200);
    const items = reply.json.items as Array<Record<string, unknown>>;
    expect(items.map((item) => [item.serial, item.revision, item.status])).toEqual([
      ['LIC-1', 1, 'Superseded'],
      ['LIC-1', 2, 'Active'],
      ['LIC-2', 1, 'Grace'],
      ['LIC-3', 1, 'Revoked'],
      ['LIC-4', 1, 'Suspended'],
    ]);
    expect(items.map((item) => item.id)).not.toContain(ids.otherTenant);
    expect(reply.json.next_cursor).toBeNull();
    const serialised = JSON.stringify(reply.json);
    expect(serialised).not.toContain('secret.signed.claims');
    expect(serialised).not.toContain('kid-secret');
    expect(Object.keys(items[1] ?? {}).sort()).toEqual(['edition', 'expiring', 'grace_until', 'id', 'issued_at', 'revision', 'seats', 'serial', 'status', 'valid_from', 'valid_until', 'version']);
    expect(items[1]).toMatchObject({ edition: 'STANDARD', seats: 20, version: 1 });
  });

  it('labels a license that ends within thirty days as expiring, and no other', async () => {
    const items = (await call('/resources/license_revision')).json.items as Array<Record<string, unknown>>;
    expect(items.map((item) => [item.revision === 2 && item.serial === 'LIC-1' ? 'active' : item.status, item.expiring])).toEqual([
      ['Superseded', false],
      ['active', true],
      ['Grace', false],
      ['Revoked', false],
      ['Suspended', false],
    ]);
  });

  it('pages by cursor and refuses a cursor that is not its own', async () => {
    const first = await call('/resources/license_revision?limit=2');
    expect((first.json.items as unknown[]).length).toBe(2);
    expect(typeof first.json.next_cursor).toBe('string');
    const second = await call(`/resources/license_revision?limit=2&cursor=${String(first.json.next_cursor)}`);
    expect((second.json.items as Array<{ id: string }>).map((item) => item.id)).toEqual([ids.grace, ids.revoked].slice(0, 2).map((id) => id));
    const bad = await call('/resources/license_revision?cursor=not-a-cursor');
    expect([bad.status, bad.json.code]).toEqual([422, 'VALIDATION_FAILED']);
  });

  it('reads one license of the own tenant and answers 404 for the license of another tenant and for an unknown id', async () => {
    const own = await call(`/resources/license_revision/${ids.active}`);
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ id: ids.active, serial: 'LIC-1', revision: 2, status: 'Active' });
    expect((await call(`/resources/license_revision/${ids.otherTenant}`)).status).toBe(404);
    expect((await call('/resources/license_revision/00000000-0000-4000-b100-0000000000ff')).status).toBe(404);
    // The other tenant reads its own.
    expect((await call(`/resources/license_revision/${ids.otherTenant}`, { tenant: TENANT_B })).status).toBe(200);
  });

  it('refuses a member without license_revision.read and a control-plane token with 403', async () => {
    expect((await call('/resources/license_revision', { member: OUTSIDER })).status).toBe(403);
    expect((await call(`/resources/license_revision/${ids.active}`, { member: OUTSIDER })).status).toBe(403);
    expect((await call('/resources/license_revision', { audience: 'control', roles: ['SystemAdmin'] })).status).toBe(403);
  });
});
