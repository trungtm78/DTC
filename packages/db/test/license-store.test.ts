import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { STANDARD_FEATURES } from '@machvon/kernel';
import type { LicenseSigner } from '@machvon/kernel';
import { Client, Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ControlDatabase, PLATFORM_TENANT_ID } from '../src/control-database';
import { InMemoryEntitlementCache } from '../src/entitlement-cache';
import { EntitlementStore } from '../src/entitlement-store';
import { LicenseStore } from '../src/license-store';
import type { IssueLicenseInput, LicenseRow } from '../src/license-store';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { TenantDatabase } from '../src/tenant-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PLACEMENT = '00000000-0000-4000-8000-0000000000b8';
const PLAN = '00000000-0000-4000-9000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000c9';
const NOW = new Date('2026-10-23T03:00:00Z');
const FROM = new Date('2026-10-01T00:00:00Z');
const UNTIL = new Date('2027-10-01T00:00:00Z');
const GRACE = new Date('2027-10-31T00:00:00Z');
const REASON = 'The contract was terminated by the agency.';
let counter = 0;

describe('licenses in the control plane (ST-SAS-003)', () => {
  let database: TestDatabase;
  let controlPool: Pool;
  let appPool: Pool;
  let control: ControlDatabase;
  let tenants: TenantDatabase;
  let entitlements: EntitlementStore;
  let store: LicenseStore;
  const pair = generateKeyPairSync('ed25519');
  const privateKeyBase64 = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const publicKeyDer = pair.publicKey.export({ format: 'der', type: 'spki' });
  const signer: LicenseSigner = { keyId: 'kid-2026', sign: (payload) => Promise.resolve(sign(null, payload, pair.privateKey)) };
  const keys = new Map([['kid-2026', publicKeyDer]]);

  async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: database.adminUrl });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  async function seedTenant(status = 'Active'): Promise<{ tenantId: string; versionId: string }> {
    counter += 1;
    const tenantId = `00000000-0000-4000-8000-${(0xe000 + counter).toString(16).padStart(12, '0')}`;
    await asAdmin((client) =>
      client.query("insert into machvon.tenant (id, code, name, status, placement_id, region) values ($1, $2, $2, $3, $4, 'vn-north')", [tenantId, `license-${counter}`, status, PLACEMENT]),
    );
    await tenants.withTenant({ tenantId, membershipId: ACTOR, scopeVersion: 1 }, (tx) =>
      entitlements.record(tx, { cause: 'PROVISIONING', planVersionId: PLAN, features: STANDARD_FEATURES }),
    );
    const rows = await asAdmin((client) => client.query<{ id: string }>('select id from machvon.entitlement_version where tenant_id = $1 and version_no = 1', [tenantId]));
    return { tenantId, versionId: rows.rows[0]?.id ?? '' };
  }

  const input = (tenantId: string, versionId: string, overrides: Partial<IssueLicenseInput> = {}): IssueLicenseInput => ({
    tenantId,
    edition: 'STANDARD',
    validFrom: FROM,
    validUntil: UNTIL,
    graceUntil: GRACE,
    entitlementVersionId: versionId,
    seats: 50,
    quota: { storage_gb: 100 },
    issuedBy: ACTOR,
    restoreTenantId: PLATFORM_TENANT_ID,
    ...overrides,
  });

  const issue = (
    tenantId: string,
    versionId: string,
    overrides: Partial<IssueLicenseInput> = {},
    whileActing: (license: LicenseRow) => Promise<void> = () => Promise.resolve(),
    signerOf: () => Promise<LicenseSigner> = () => Promise.resolve(signer),
  ): Promise<LicenseRow> => control.withTenantOf(PLATFORM_TENANT_ID, (tx) => store.issue(tx, input(tenantId, versionId, overrides), signerOf, whileActing, NOW));

  const revoke = (licenseId: string, expectedVersion: number, reason = REASON, whileActing: (license: LicenseRow) => Promise<void> = () => Promise.resolve()): Promise<LicenseRow> =>
    control.withTenantOf(PLATFORM_TENANT_ID, (tx) => store.revoke(tx, { licenseId, reason, expectedVersion, restoreTenantId: PLATFORM_TENANT_ID }, whileActing));

  const licensesOf = (tenantId: string): Promise<LicenseRow[]> => tenants.withTenant({ tenantId, membershipId: ACTOR, scopeVersion: 1 }, (tx) => store.list(tx, { limit: 50, after: undefined }));
  const versionCount = async (tenantId: string): Promise<number> =>
    Number((await asAdmin((client) => client.query<{ n: string }>('select count(*) as n from machvon.entitlement_version where tenant_id = $1', [tenantId]))).rows[0]?.n);

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    controlPool = new Pool({ connectionString: database.urlFor('machvon_control'), max: 6 });
    controlPool.on('error', () => undefined);
    appPool = new Pool({ connectionString: database.urlFor('machvon_app'), max: 4 });
    appPool.on('error', () => undefined);
    control = new ControlDatabase(controlPool);
    tenants = new TenantDatabase(appPool);
    entitlements = new EntitlementStore(tenants, new InMemoryEntitlementCache());
    store = new LicenseStore(entitlements);
    await asAdmin((client) =>
      client.query("insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status) values ($1, 'POOL', 'vn-north', 'north-8', 'kms-8', 'Active')", [PLACEMENT]),
    );
    const registered = await control.withControl((tx) =>
      store.registerSigningKey(tx, {
        keyId: 'kid-2026',
        publicKeyPem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        kmsKeyRef: 'env:LICENSE_SIGNING_KEY_PEM_PATH',
        notBefore: new Date('2026-01-01T00:00:00Z'),
        notAfter: new Date('2028-01-01T00:00:00Z'),
      }),
    );
    expect(registered).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([controlPool?.end(), appPool?.end()]);
    if (database) await database.stop();
  }, 60_000);

  describe('issuing', () => {
    it('stores revision 1 as Issued, signed with the active key, and records a new entitlement version for the tenant', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      expect(license).toMatchObject({ tenantId, revision: 1, edition: 'STANDARD', status: 'Issued', seats: 50, quota: { storage_gb: 100 }, keyId: 'kid-2026', version: 1, issuer: 'machvon-platform', issuedBy: ACTOR });
      expect(license.serial).toMatch(/^LIC-20261023-0001$/);
      expect(license.validFrom).toEqual(FROM);
      expect(license.validUntil).toEqual(UNTIL);
      expect(license.graceUntil).toEqual(GRACE);
      expect(store.verifySignature(license, keys)).toBe('VALID');
      expect(await versionCount(tenantId)).toBe(2);
      const recorded = await asAdmin((client) => client.query<{ cause: string }>('select cause from machvon.entitlement_version where tenant_id = $1 and version_no = 2', [tenantId]));
      expect(recorded.rows[0]?.cause).toBe('LICENSE_CHANGE');
      expect(await asAdmin((client) => client.query("select 1 from machvon.outbox_event where tenant_id = $1 and type = 'sas.entitlement.changed.v1' and (payload->>'version_no')::int = 2", [tenantId]))).toMatchObject({ rowCount: 1 });
    });

    it('signs the entitlement hash of the version named, the window, the seats and the quota, and the claims name no secret', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId, { deploymentBinding: 'cluster-north-1' });
      const claims = JSON.parse(Buffer.from(license.signedClaims.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
      const hash = (await asAdmin((client) => client.query<{ entitlements_hash: string }>('select entitlements_hash from machvon.entitlement_version where id = $1', [versionId]))).rows[0]?.entitlements_hash;
      expect(claims).toMatchObject({
        iss: 'machvon-platform',
        tenant_id: tenantId,
        license_id: license.id,
        serial: license.serial,
        revision: 1,
        edition: 'STANDARD',
        valid_from: FROM.toISOString(),
        valid_until: UNTIL.toISOString(),
        grace_until: GRACE.toISOString(),
        entitlements_hash: hash,
        seats: 50,
        quota: { storage_gb: 100 },
        deployment_binding: 'cluster-north-1',
        kid: 'kid-2026',
      });
      expect(JSON.stringify(claims)).not.toContain(privateKeyBase64);
    });

    it('keeps the private key out of every table it touched', async () => {
      const { tenantId, versionId } = await seedTenant();
      await issue(tenantId, versionId);
      const dump = await asAdmin(async (client) => {
        const revisions = await client.query<{ doc: string }>('select to_jsonb(l)::text as doc from machvon.license_revision l');
        const signingKeys = await client.query<{ doc: string }>('select to_jsonb(k)::text as doc from machvon.license_signing_key k');
        const events = await client.query<{ doc: string }>('select to_jsonb(e)::text as doc from machvon.outbox_event e');
        return [...revisions.rows, ...signingKeys.rows, ...events.rows].map((row) => row.doc).join('\n');
      });
      expect(dump).not.toContain(privateKeyBase64);
      expect(dump).not.toContain('PRIVATE KEY');
    });

    it('fails verification after one byte of the signed payload changes, and after the row is edited', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      const [header, payload, signature] = license.signedClaims.split('.') as [string, string, string];
      const flipped = Buffer.from(payload, 'base64url');
      flipped[10] = (flipped[10] ?? 0) ^ 0x01;
      expect(store.verifySignature({ ...license, signedClaims: `${header}.${flipped.toString('base64url')}.${signature}` }, keys)).not.toBe('VALID');
      expect(store.verifySignature({ ...license, validUntil: new Date(UNTIL.getTime() + 86_400_000) }, keys)).toBe('CLAIMS_MISMATCH');
      expect(store.verifySignature({ ...license, tenantId: PLATFORM_TENANT_ID }, keys)).toBe('CLAIMS_MISMATCH');
      expect(store.verifySignature(license, new Map())).toBe('UNKNOWN_KEY');
      expect(store.verifySignature({ ...license, signedClaims: 'garbage' }, keys)).toBe('MALFORMED');
    });

    it('acts as the tenant while the hook runs and returns to the platform tenant afterwards', async () => {
      const { tenantId, versionId } = await seedTenant();
      const seen: string[] = [];
      await control.withTenantOf(PLATFORM_TENANT_ID, async (tx) => {
        const current = async (): Promise<string> => (await tx.query<{ tenant: string }>("select current_setting('app.tenant_id') as tenant"))[0]?.tenant ?? '';
        await store.issue(tx, input(tenantId, versionId), () => Promise.resolve(signer), async () => void seen.push(await current()), NOW);
        seen.push(await current());
      });
      expect(seen).toEqual([tenantId, PLATFORM_TENANT_ID]);
    });

    it.each([
      ['valid_from equal to valid_until', { validFrom: UNTIL }, 'valid_until'],
      ['valid_from after valid_until', { validFrom: new Date('2028-01-01T00:00:00Z') }, 'valid_until'],
      ['grace_until before valid_until', { graceUntil: new Date('2027-09-30T00:00:00Z') }, 'grace_until'],
      ['a window that ended already', { validFrom: new Date('2025-01-01T00:00:00Z'), validUntil: new Date('2026-10-22T00:00:00Z'), graceUntil: new Date('2026-10-22T00:00:00Z') }, 'valid_until'],
      ['an offline lease on a license that is not PRIVATE', { offlineLeaseDays: 10 }, 'offline_lease_days'],
      ['an offline lease of more than 30 days', { edition: 'PRIVATE', offlineLeaseDays: 31 }, 'offline_lease_days'],
      ['an offline lease that outlives the grace period', { edition: 'PRIVATE', offlineLeaseDays: 30, validUntil: new Date('2026-10-28T00:00:00Z'), graceUntil: new Date('2026-11-05T00:00:00Z') }, 'offline_lease_days'],
    ] as const)('refuses %s with 422 LICENSE_RANGE_INVALID on %s and stores nothing', async (_label, overrides, field) => {
      const { tenantId, versionId } = await seedTenant();
      await expect(issue(tenantId, versionId, overrides as Partial<IssueLicenseInput>)).rejects.toMatchObject({ code: 'LICENSE_RANGE_INVALID', status: 422, detail: field });
      expect(await licensesOf(tenantId)).toHaveLength(0);
      expect(await versionCount(tenantId)).toBe(1);
    });

    it('refuses fewer than one seat', async () => {
      const { tenantId, versionId } = await seedTenant();
      await expect(issue(tenantId, versionId, { seats: 0 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422, detail: 'seats' });
    });

    it('accepts a private deployment with an offline lease inside the grace period', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId, { edition: 'PRIVATE', offlineLeaseDays: 30, deploymentBinding: 'site-1' });
      expect(license.offlineLeaseUntil).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
      expect(license.deploymentBinding).toBe('site-1');
    });

    it('refuses a window that overlaps a revision that is not revoked, and accepts the window right after it and one after a revocation', async () => {
      const { tenantId, versionId } = await seedTenant();
      const first = await issue(tenantId, versionId);
      await expect(issue(tenantId, versionId, { validFrom: new Date('2027-06-01T00:00:00Z'), validUntil: new Date('2028-06-01T00:00:00Z'), graceUntil: new Date('2028-06-30T00:00:00Z') })).rejects.toMatchObject({
        code: 'LICENSE_RANGE_INVALID',
        detail: 'valid_from',
      });
      await expect(issue(tenantId, versionId, { validFrom: new Date('2026-09-01T00:00:00Z'), validUntil: new Date('2026-10-02T00:00:00Z'), graceUntil: new Date('2026-10-02T00:00:00Z') })).rejects.toMatchObject({ code: 'LICENSE_RANGE_INVALID' });
      const next = await issue(tenantId, versionId, { validFrom: UNTIL, validUntil: new Date('2028-10-01T00:00:00Z'), graceUntil: new Date('2028-10-31T00:00:00Z') });
      expect(next.serial).not.toBe(first.serial);
      await revoke(next.id, 1);
      await revoke(first.id, 1);
      const again = await issue(tenantId, versionId);
      expect(again.status).toBe('Issued');
      expect((await licensesOf(tenantId)).map((license) => license.status).sort()).toEqual(['Issued', 'Revoked', 'Revoked']);
    });

    it('lets exactly one of two concurrent issues for the same window win', async () => {
      const { tenantId, versionId } = await seedTenant();
      const results = await Promise.allSettled([issue(tenantId, versionId), issue(tenantId, versionId)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'LICENSE_RANGE_INVALID' } });
      expect(await licensesOf(tenantId)).toHaveLength(1);
    });

    it('refuses the entitlement version of another tenant, and one that does not exist, with 422 LICENSE_TENANT_MISMATCH', async () => {
      const a = await seedTenant();
      const b = await seedTenant();
      await expect(issue(a.tenantId, b.versionId)).rejects.toMatchObject({ code: 'LICENSE_TENANT_MISMATCH', status: 422, detail: 'entitlement_version_id' });
      await expect(issue(a.tenantId, randomUUID())).rejects.toMatchObject({ code: 'LICENSE_TENANT_MISMATCH', status: 422 });
      expect(await licensesOf(a.tenantId)).toHaveLength(0);
      expect(await licensesOf(b.tenantId)).toHaveLength(0);
    });

    it.each(['Requested', 'Archived'])('refuses a %s tenant with 409 TENANT_STATE_INVALID', async (status) => {
      const { tenantId, versionId } = await seedTenant(status);
      await expect(issue(tenantId, versionId)).rejects.toMatchObject({ code: 'TENANT_STATE_INVALID', status: 409 });
    });

    it.each(['Provisioning', 'Active', 'Suspended', 'Offboarding'])('issues for a %s tenant', async (status) => {
      const { tenantId, versionId } = await seedTenant(status);
      expect((await issue(tenantId, versionId)).status).toBe('Issued');
    });

    it('answers 404 for a tenant that does not exist', async () => {
      await expect(issue('00000000-0000-4000-8000-00000000f999', randomUUID())).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });

    it.each([
      ['a key that is not registered', { keyId: 'kid-unknown' }],
      ['a key outside its window', { keyId: 'kid-expired' }],
      ['a retiring key', { keyId: 'kid-retiring' }],
    ])('refuses %s with 503 SIGNING_KEY_UNAVAILABLE and stores nothing', async (_label, patch) => {
      await asAdmin(async (client) => {
        await client.query(
          `insert into machvon.license_signing_key (id, algorithm, public_key_pem, kms_key_ref, status, not_before, not_after) values
             ('kid-expired', 'EdDSA', 'pem', 'ref', 'Active', '2020-01-01', '2021-01-01'), ('kid-retiring', 'EdDSA', 'pem', 'ref', 'Retiring', '2026-01-01', '2028-01-01')
           on conflict do nothing`,
        );
      });
      const { tenantId, versionId } = await seedTenant();
      await expect(issue(tenantId, versionId, {}, undefined, () => Promise.resolve({ ...signer, ...patch }))).rejects.toMatchObject({ code: 'SIGNING_KEY_UNAVAILABLE', status: 503 });
      expect(await licensesOf(tenantId)).toHaveLength(0);
      expect(await versionCount(tenantId)).toBe(1);
    });

    it('does not ask for the signing key when an earlier check already refused, and passes on the refusal of the key store', async () => {
      const { tenantId, versionId } = await seedTenant();
      let asked = 0;
      const missing = (): Promise<LicenseSigner> => {
        asked += 1;
        return Promise.reject(Object.assign(new Error('no key'), { code: 'SIGNING_KEY_UNAVAILABLE' }));
      };
      await expect(issue(tenantId, versionId, { validFrom: UNTIL }, undefined, missing)).rejects.toMatchObject({ code: 'LICENSE_RANGE_INVALID' });
      expect(asked).toBe(0);
      await expect(issue(tenantId, versionId, {}, undefined, missing)).rejects.toThrow('no key');
      expect(asked).toBe(1);
    });

    it('rolls everything back when the hook fails', async () => {
      const { tenantId, versionId } = await seedTenant();
      await expect(issue(tenantId, versionId, {}, () => Promise.reject(new Error('audit failed')))).rejects.toThrow('audit failed');
      expect(await licensesOf(tenantId)).toHaveLength(0);
      expect(await versionCount(tenantId)).toBe(1);
    });
  });

  describe('revoking', () => {
    it('ends the license: status Revoked, the reason and a new version, a new entitlement version, and the hook saw the revoked row', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      const seen: LicenseRow[] = [];
      const revoked = await revoke(license.id, 1, `  ${REASON}  `, (row) => Promise.resolve(void seen.push(row)));
      expect(revoked).toMatchObject({ id: license.id, status: 'Revoked', statusReason: REASON, version: 2, revision: 1 });
      expect(seen).toHaveLength(1);
      expect(store.statusAt(revoked, new Date('2027-03-01T00:00:00Z'))).toBe('Revoked');
      expect(await versionCount(tenantId)).toBe(3);
      // The signed claims were not touched: the signature of a revoked license still verifies.
      expect(store.verifySignature(revoked, keys)).toBe('VALID');
    });

    it('refuses a second revocation, a draft and a superseded license with 409 LICENSE_STATE_INVALID', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      await revoke(license.id, 1);
      await expect(revoke(license.id, 2)).rejects.toMatchObject({ code: 'LICENSE_STATE_INVALID', status: 409 });
      for (const status of ['Superseded', 'Draft', 'Expired']) {
        const other = await seedTenant();
        const row = await issue(other.tenantId, other.versionId);
        await asAdmin((client) => client.query('update machvon.license_revision set status = $1 where id = $2', [status, row.id]));
        await expect(revoke(row.id, 1)).rejects.toMatchObject({ code: 'LICENSE_STATE_INVALID', status: 409 });
      }
    });

    it('revokes a license that is Active, in Grace or Suspended', async () => {
      for (const status of ['Active', 'Grace', 'Suspended']) {
        const { tenantId, versionId } = await seedTenant();
        const row = await issue(tenantId, versionId);
        await asAdmin((client) => client.query("update machvon.license_revision set status = $1, status_reason = 'Suspended for the review of the contract.' where id = $2", [status, row.id]));
        expect((await revoke(row.id, 1)).status).toBe('Revoked');
      }
    });

    it('refuses a stale version with 409 VERSION_CONFLICT that names the current one', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      await expect(revoke(license.id, 7)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409, extensions: { current_version: 1 } });
      expect((await licensesOf(tenantId))[0]?.status).toBe('Issued');
    });

    it('answers 404 for a license that does not exist and 422 for a reason that is too short', async () => {
      await expect(revoke(randomUUID(), 1)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      await expect(revoke(license.id, 1, '          ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422, detail: 'reason' });
      await expect(revoke(license.id, 1, 'too short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    });

    it('lets exactly one of two concurrent revocations win', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      const results = await Promise.allSettled([revoke(license.id, 1), revoke(license.id, 1)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    });

    it('rolls the revocation back when the hook fails', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      await expect(revoke(license.id, 1, REASON, () => Promise.reject(new Error('audit failed')))).rejects.toThrow('audit failed');
      expect((await licensesOf(tenantId))[0]).toMatchObject({ status: 'Issued', version: 1 });
    });
  });

  describe('reading', () => {
    it('lists the revisions of the tenant by serial and revision in keyset pages, and finds one by id', async () => {
      const { tenantId, versionId } = await seedTenant();
      const first = await issue(tenantId, versionId);
      const second = await issue(tenantId, versionId, { validFrom: UNTIL, validUntil: new Date('2028-10-01T00:00:00Z'), graceUntil: new Date('2028-10-31T00:00:00Z') });
      const context = { tenantId, membershipId: ACTOR, scopeVersion: 1 };
      const page1 = await tenants.withTenant(context, (tx) => store.list(tx, { limit: 1, after: undefined }));
      expect(page1.map((row) => row.id)).toEqual([first.id]);
      const page2 = await tenants.withTenant(context, (tx) => store.list(tx, { limit: 5, after: { code: first.serial, id: first.id } }));
      expect(page2.map((row) => row.id)).toEqual([second.id]);
      expect((await tenants.withTenant(context, (tx) => store.find(tx, second.id)))?.serial).toBe(second.serial);
    });

    it('never shows the license of one tenant to another', async () => {
      const a = await seedTenant();
      const b = await seedTenant();
      const license = await issue(a.tenantId, a.versionId);
      expect(await licensesOf(b.tenantId)).toHaveLength(0);
      expect(await tenants.withTenant({ tenantId: b.tenantId, membershipId: ACTOR, scopeVersion: 1 }, (tx) => store.find(tx, license.id))).toBeUndefined();
    });
  });

  describe('what the database allows', () => {
    it('lets the application role read licenses and nothing else: it cannot insert, update or delete a revision', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      const asTenant = <T>(work: (client: PoolClient) => Promise<T>): Promise<T> =>
        appPool.connect().then(async (client) => {
          try {
            await client.query('begin');
            await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
            return await work(client);
          } finally {
            await client.query('rollback');
            client.release();
          }
        });
      expect(await asTenant((client) => client.query('select id from machvon.license_revision'))).toMatchObject({ rowCount: 1 });
      await expect(asTenant((client) => client.query("update machvon.license_revision set status = 'Revoked' where id = $1", [license.id]))).rejects.toThrow('permission denied');
      await expect(asTenant((client) => client.query('delete from machvon.license_revision where id = $1', [license.id]))).rejects.toThrow('permission denied');
      await expect(
        asTenant((client) =>
          client.query(
            `insert into machvon.license_revision (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, signed_claims, key_id)
             values ($1, gen_random_uuid(), 'X', 1, $2, now(), now() + interval '1 day', now() + interval '1 day', 'Issued', 'x', 'kid-2026')`,
            [tenantId, versionId],
          ),
        ),
      ).rejects.toThrow('permission denied');
      await expect(asTenant((client) => client.query('select id from machvon.license_signing_key'))).rejects.toThrow('permission denied');
    });

    it('lets the control role change only the status, the reason and the version of a revision, never delete it', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      const asControl = (sql: string, params: unknown[]): Promise<unknown> => control.withTenantOf(tenantId, (tx) => tx.query(sql, params));
      await expect(asControl('update machvon.license_revision set valid_until = valid_until + interval \'1 year\' where id = $1', [license.id])).rejects.toThrow('permission denied');
      await expect(asControl("update machvon.license_revision set signed_claims = 'forged' where id = $1", [license.id])).rejects.toThrow('permission denied');
      await expect(asControl('delete from machvon.license_revision where id = $1', [license.id])).rejects.toThrow('permission denied');
      await expect(asControl("update machvon.license_signing_key set status = 'Revoked' where id = 'kid-2026'", [])).rejects.toThrow('permission denied');
    });

    it('finds the tenant of a license for the control role only, and leaves the tenant setting as it found it', async () => {
      const { tenantId, versionId } = await seedTenant();
      const license = await issue(tenantId, versionId);
      const found = await control.withTenantOf(PLATFORM_TENANT_ID, async (tx) => {
        const owner = (await tx.query<{ tenant_id: string | null }>('select machvon.license_tenant_of($1::uuid) as tenant_id', [license.id]))[0]?.tenant_id;
        const setting = (await tx.query<{ tenant: string }>("select current_setting('app.tenant_id') as tenant"))[0]?.tenant;
        const none = (await tx.query<{ tenant_id: string | null }>('select machvon.license_tenant_of($1::uuid) as tenant_id', [randomUUID()]))[0]?.tenant_id;
        return { owner, setting, none };
      });
      expect(found).toEqual({ owner: tenantId, setting: PLATFORM_TENANT_ID, none: null });
      const client = await appPool.connect();
      try {
        await expect(client.query('select machvon.license_tenant_of($1::uuid)', [license.id])).rejects.toThrow('permission denied');
      } finally {
        client.release();
      }
    });

    it('registers a key once: a second registration of the same key id changes nothing', async () => {
      const again = await control.withControl((tx) =>
        store.registerSigningKey(tx, { keyId: 'kid-2026', publicKeyPem: 'other', kmsKeyRef: 'other', notBefore: new Date('2026-01-01T00:00:00Z'), notAfter: new Date('2029-01-01T00:00:00Z') }),
      );
      expect(again).toBe(false);
      const stored = await asAdmin((client) => client.query<{ public_key_pem: string }>("select public_key_pem from machvon.license_signing_key where id = 'kid-2026'"));
      expect(stored.rows[0]?.public_key_pem).toContain('BEGIN PUBLIC KEY');
    });

    it('has registered the license reminder as a notification event type with a payload schema', async () => {
      const rows = await asAdmin((client) =>
        client.query<{ owning_module: string; status: string; allowed_purposes: string[]; payload_schema: { required: string[] } }>(
          "select owning_module, status, allowed_purposes, payload_schema from machvon.notification_event_type where event_type = 'sas.license.expiring.v1' and schema_version = 1",
        ),
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({ owning_module: 'SAS', status: 'Active', allowed_purposes: ['REMINDER', 'OPERATIONAL'] });
      expect(rows.rows[0]?.payload_schema.required).toEqual(['tenant_id', 'license_id', 'serial', 'valid_until', 'days_left']);
    });
  });
});
