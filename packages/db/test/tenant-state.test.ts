import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { ControlDatabase, PLATFORM_TENANT_ID } from '../src/control-database';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { SUSPENSION_REASONS, accessPolicyOf, assertPolicyMatchesReason, resumeTenant, suspendTenant } from '../src/tenant-state';
import type { StateChange } from '../src/tenant-state';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PLACEMENT = '00000000-0000-4000-8000-0000000000b9';
let counter = 0;

describe('the policy a suspension implies (SAS 3.6)', () => {
  it('knows the five reason codes and maps a security incident to NO_ACCESS, every other reason to READ_ONLY_EXPORT', () => {
    expect([...SUSPENSION_REASONS].sort()).toEqual(['CUSTOMER_REQUEST', 'LEGAL_ORDER', 'LICENSE_REVOKED', 'NON_PAYMENT', 'SECURITY_INCIDENT']);
    expect(accessPolicyOf('SECURITY_INCIDENT')).toBe('NO_ACCESS');
    for (const reason of SUSPENSION_REASONS.filter((candidate) => candidate !== 'SECURITY_INCIDENT')) expect(accessPolicyOf(reason)).toBe('READ_ONLY_EXPORT');
  });

  it.each([
    ['SECURITY_INCIDENT', 'READ_ONLY_EXPORT'],
    ['NON_PAYMENT', 'NO_ACCESS'],
  ] as const)('refuses %s with %s as 422 VALIDATION_FAILED naming access_policy', (reason, policy) => {
    expect(() => assertPolicyMatchesReason(reason, policy)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED', status: 422, detail: 'access_policy' }));
  });

  it('accepts the policy the reason implies', () => {
    expect(() => assertPolicyMatchesReason('SECURITY_INCIDENT', 'NO_ACCESS')).not.toThrow();
    expect(() => assertPolicyMatchesReason('LEGAL_ORDER', 'READ_ONLY_EXPORT')).not.toThrow();
  });
});

describe('suspending and resuming a tenant in the control plane (ST-SAS-004)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let control: ControlDatabase;

  async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: database.adminUrl });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  async function seedTenant(status: string): Promise<string> {
    counter += 1;
    const id = `00000000-0000-4000-8000-${(0xd000 + counter).toString(16).padStart(12, '0')}`;
    await asAdmin((client) =>
      client.query("insert into machvon.tenant (id, code, name, status, placement_id, region) values ($1, $2, $2, $3, $4, 'vn-north')", [id, `state-${counter}`, status, PLACEMENT]),
    );
    return id;
  }

  const row = (tenantId: string): Promise<{ status: string; reason: string | null; suspended: boolean; version: number }> =>
    asAdmin(async (client) => {
      const { rows } = await client.query<{ status: string; lifecycle_reason: string | null; suspended_at: Date | null; version: string }>(
        'select status, lifecycle_reason, suspended_at, version::text as version from machvon.tenant where id = $1',
        [tenantId],
      );
      const found = rows[0];
      if (found === undefined) throw new Error('tenant missing');
      return { status: found.status, reason: found.lifecycle_reason, suspended: found.suspended_at !== null, version: Number(found.version) };
    });

  const runtime = (tenantId: string): Promise<string | undefined> =>
    asAdmin(async (client) => (await client.query<{ access_policy: string }>('select access_policy from machvon.tenant_runtime($1::uuid)', [tenantId])).rows[0]?.access_policy);

  const suspend = (tenantId: string, overrides: Partial<Parameters<typeof suspendTenant>[1]> = {}, hook: (change: StateChange) => Promise<void> = () => Promise.resolve()) =>
    control.withTenantOf(PLATFORM_TENANT_ID, (tx) =>
      suspendTenant(tx, { tenantId, reasonCode: 'NON_PAYMENT', accessPolicy: 'READ_ONLY_EXPORT', expectedVersion: 1, restoreTenantId: PLATFORM_TENANT_ID, ...overrides }, hook),
    );

  const resume = (tenantId: string, expectedVersion: number, hook: (change: StateChange) => Promise<void> = () => Promise.resolve()) =>
    control.withTenantOf(PLATFORM_TENANT_ID, (tx) => resumeTenant(tx, { tenantId, expectedVersion, restoreTenantId: PLATFORM_TENANT_ID }, hook));

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    pool = new Pool({ connectionString: database.urlFor('machvon_control'), max: 4 });
    pool.on('error', () => undefined);
    control = new ControlDatabase(pool);
    await asAdmin((client) =>
      client.query("insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status) values ($1, 'POOL', 'vn-north', 'north-9', 'kms-9', 'Active')", [PLACEMENT]),
    );
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (database) await database.stop();
  }, 60_000);

  it('suspends an Active tenant: status, reason, time and version change, and the policy is the one the reason implies', async () => {
    const tenantId = await seedTenant('Active');
    const change = await suspend(tenantId);
    expect(change).toEqual({ tenantId, from: 'Active', to: 'Suspended', version: 2, reasonCode: 'NON_PAYMENT' });
    expect(await row(tenantId)).toEqual({ status: 'Suspended', reason: 'NON_PAYMENT', suspended: true, version: 2 });
    expect(await runtime(tenantId)).toBe('READ_ONLY_EXPORT');
  });

  it('suspends for a security incident with no access at all', async () => {
    const tenantId = await seedTenant('Active');
    await suspend(tenantId, { reasonCode: 'SECURITY_INCIDENT', accessPolicy: 'NO_ACCESS' });
    expect(await runtime(tenantId)).toBe('NO_ACCESS');
  });

  it('acts as the affected tenant while the hook runs and returns to the platform tenant afterwards', async () => {
    const tenantId = await seedTenant('Active');
    const seen: string[] = [];
    await control.withTenantOf(PLATFORM_TENANT_ID, async (tx) => {
      await suspendTenant(tx, { tenantId, reasonCode: 'LEGAL_ORDER', accessPolicy: 'READ_ONLY_EXPORT', expectedVersion: 1, restoreTenantId: PLATFORM_TENANT_ID }, async () => {
        seen.push((await tx.query<{ tenant: string }>("select current_setting('app.tenant_id') as tenant"))[0]?.tenant ?? '');
      });
      seen.push((await tx.query<{ tenant: string }>("select current_setting('app.tenant_id') as tenant"))[0]?.tenant ?? '');
    });
    expect(seen).toEqual([tenantId, PLATFORM_TENANT_ID]);
  });

  it('rolls the state change back when the hook fails', async () => {
    const tenantId = await seedTenant('Active');
    await expect(suspend(tenantId, {}, () => Promise.reject(new Error('audit failed')))).rejects.toThrow('audit failed');
    expect(await row(tenantId)).toMatchObject({ status: 'Active', version: 1 });
  });

  it('resumes a Suspended tenant: Active again, reason and suspension time cleared, version up', async () => {
    const tenantId = await seedTenant('Active');
    await suspend(tenantId);
    const change = await resume(tenantId, 2);
    expect(change).toEqual({ tenantId, from: 'Suspended', to: 'Active', version: 3 });
    expect(await row(tenantId)).toEqual({ status: 'Active', reason: null, suspended: false, version: 3 });
    expect(await runtime(tenantId)).toBe('FULL');
  });

  it.each(['Requested', 'Provisioning', 'Failed', 'Suspended', 'Offboarding', 'Archived'])('refuses to suspend a %s tenant with 409 TENANT_STATE_INVALID', async (status) => {
    const tenantId = await seedTenant(status);
    await expect(suspend(tenantId)).rejects.toMatchObject({ code: 'TENANT_STATE_INVALID', status: 409 });
    expect((await row(tenantId)).status).toBe(status);
  });

  it.each(['Requested', 'Active', 'Offboarding', 'Archived'])('refuses to resume a %s tenant with 409 TENANT_STATE_INVALID', async (status) => {
    const tenantId = await seedTenant(status);
    await expect(resume(tenantId, 1)).rejects.toMatchObject({ code: 'TENANT_STATE_INVALID', status: 409 });
  });

  it('refuses a stale version with 409 VERSION_CONFLICT that names the current one', async () => {
    const tenantId = await seedTenant('Active');
    await expect(suspend(tenantId, { expectedVersion: 7 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409, extensions: { current_version: 1 } });
    expect((await row(tenantId)).status).toBe('Active');
  });

  it('answers 404 for a tenant that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-00000000d999';
    await expect(suspend(missing)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    await expect(resume(missing, 1)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });

  it('refuses a reason and a policy that disagree before it touches the tenant', async () => {
    const tenantId = await seedTenant('Active');
    await expect(suspend(tenantId, { reasonCode: 'SECURITY_INCIDENT', accessPolicy: 'READ_ONLY_EXPORT' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect((await row(tenantId)).status).toBe('Active');
  });

  it('lets exactly one of two concurrent suspensions with the same version win', async () => {
    const tenantId = await seedTenant('Active');
    const results = await Promise.allSettled([suspend(tenantId), suspend(tenantId)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure).toMatchObject({ reason: { status: 409 } });
    expect((await row(tenantId)).version).toBe(2);
  });
});
