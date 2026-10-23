import { createHash, generateKeyPairSync } from 'node:crypto';
import { AuditWriter, EntitlementStore, InMemoryEntitlementCache, LicenseStore, PLATFORM_TENANT_ID, SYSTEM_ROLES, TenantBootstrapStore, ThemeStore, TRIAL_DAYS } from '@machvon/db';
import type { TenantRegistry } from '@machvon/db';
import { DomainError, verifyLicenseToken } from '@machvon/kernel';
import type { LicenseSigner } from '@machvon/kernel';
import { MockInvitationMailer } from '../../src/modules/adm/invitation-mailer';
import { Ed25519LicenseSigner } from '../../src/modules/sas/license-signer';
import type { LicenseKeyStore } from '../../src/modules/sas/license-signer';
import { assertValidTheme } from '../../src/modules/sas/theme-validation';
import { defaultTenantTheme } from '../../src/provisioning/default-theme';
import { activationRecorder, createProvisioningSteps, provisioningStepDefinitions } from '../../src/provisioning/provisioning-steps';
import type { ProvisioningServices } from '../../src/provisioning/provisioning-steps';
import { ProvisioningSaga } from '../../src/provisioning/saga';
import { PROVISIONING_STEPS } from '@machvon/db';
import { Crash, FaultyPorts, ProvisioningHarness, REQUESTER } from './provisioning-fixtures';

const STANDARD_PLAN = '00000000-0000-4000-9000-000000000001';
const KEY_ID = 'kid-provisioning';
const DAY_MS = 86_400_000;
const LATER_STEPS = PROVISIONING_STEPS.slice(5);

class TestKeys implements LicenseKeyStore {
  available = true;
  private readonly pair = generateKeyPairSync('ed25519');
  readonly signer: LicenseSigner = new Ed25519LicenseSigner(KEY_ID, this.pair.privateKey);
  readonly publicKeyDer = this.pair.publicKey.export({ format: 'der', type: 'spki' });
  readonly publicKeyPem = this.pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();

  current(): Promise<LicenseSigner> {
    return this.available ? Promise.resolve(this.signer) : Promise.reject(new DomainError('SIGNING_KEY_UNAVAILABLE', 503));
  }

  publicKeys(): Promise<ReadonlyMap<string, Uint8Array>> {
    return Promise.resolve(new Map([[KEY_ID, this.publicKeyDer]]));
  }
}

describe('ProvisioningSaga, steps 6 to 11 (ST-SAS-006)', () => {
  const harness = new ProvisioningHarness();
  const keys = new TestKeys();
  let mailer: MockInvitationMailer;
  let services: ProvisioningServices;
  let ports: FaultyPorts;
  let licenses: LicenseStore;
  let delays: number[];

  const saga = (overrides: { registry?: TenantRegistry; services?: ProvisioningServices; delay?: (seconds: number) => Promise<void> } = {}): ProvisioningSaga => {
    const used = overrides.services ?? services;
    return new ProvisioningSaga(overrides.registry ?? harness.registry, ports, {
      steps: createProvisioningSteps(used),
      onCompleted: activationRecorder(used),
      delay:
        overrides.delay ??
        ((seconds) => {
          delays.push(seconds);
          return Promise.resolve();
        }),
    });
  };

  const requested = (overrides: { rootUnitName?: string; initialOwnerEmail?: string } = {}) => harness.request({ planVersionId: STANDARD_PLAN, ...overrides });

  const count = (sql: string, tenantId: string): Promise<number> => harness.count(sql, [tenantId]);

  /** Everything a finished run leaves, as numbers: the same after a crash and a resume as after a clean run. */
  async function footprint(tenantId: string): Promise<Record<string, number>> {
    const table = (name: string): Promise<number> => count(`select count(*) as n from machvon.${name} where tenant_id = $1`, tenantId);
    return {
      versions: await table('entitlement_version'),
      subscriptions: await table('subscription'),
      licenses: await table('license_revision'),
      roles: await table('role_definition'),
      units: await table('organization_unit'),
      themes: await table('tenant_theme_version'),
      pointers: await table('tenant_theme_pointer'),
      memberships: await table('membership'),
      grants: await table('role_grant'),
      pending: await count("select count(*) as n from machvon.membership_invitation where tenant_id = $1 and status = 'Pending'", tenantId),
    };
  }

  const stepStatus = async (tenantId: string, step: string): Promise<{ status: string; attempts: number; error_code?: string | null } | undefined> =>
    (await harness.registry.loadRun(tenantId, 1))?.steps[step as (typeof PROVISIONING_STEPS)[number]];

  beforeAll(async () => {
    await harness.start();
    const entitlements = new EntitlementStore(harness.tenants, new InMemoryEntitlementCache());
    licenses = new LicenseStore(entitlements);
    await harness.control.withControl((tx) =>
      licenses.registerSigningKey(tx, { keyId: KEY_ID, publicKeyPem: keys.publicKeyPem, kmsKeyRef: 'test', notBefore: new Date(Date.now() - 30 * DAY_MS), notAfter: new Date(Date.now() + 730 * DAY_MS) }),
    );
    mailer = new MockInvitationMailer();
    services = {
      control: harness.control,
      entitlements,
      licenses,
      keys,
      themes: new ThemeStore(),
      bootstrap: new TenantBootstrapStore(),
      audit: new AuditWriter(harness.tenants),
      mailer,
    };
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  beforeEach(() => {
    delays = [];
    ports = new FaultyPorts();
    keys.available = true;
  });

  describe('a full run', () => {
    it('ends with the tenant Active and everything a new tenant needs, every step recorded, and nothing of it unrecorded', async () => {
      const { tenantId } = await requested({ rootUnitName: 'Ủy ban nhân dân tỉnh Kiểm Thử', initialOwnerEmail: 'Owner.One@Example.org' });
      expect(await saga().run(tenantId, 1)).toBe('Completed');

      const detail = await harness.registry.getDetail(tenantId);
      expect(detail?.tenant.status).toBe('Active');
      expect(detail?.run).toMatchObject({ status: 'Succeeded' });
      for (const step of PROVISIONING_STEPS) expect(detail?.run?.steps[step]).toMatchObject({ status: 'DONE', attempts: 1 });
      expect(await harness.count('select count(*) as n from machvon.tenant where id = $1 and activated_at is not null', [tenantId])).toBe(1);

      const sql = <T extends object>(text: string): Promise<T[]> => harness.admin((client) => client.query<T>(text, [tenantId]).then((result) => result.rows));
      expect(await sql("select version_no::int as n, cause from machvon.entitlement_version where tenant_id = $1 order by version_no")).toEqual([
        { n: 1, cause: 'PROVISIONING' },
        { n: 2, cause: 'LICENSE_CHANGE' },
      ]);
      expect(await sql("select status, plan_version_id, trial_ends_at is not null as trial from machvon.subscription where tenant_id = $1")).toEqual([{ status: 'Trialing', plan_version_id: STANDARD_PLAN, trial: true }]);
      const [license] = await sql<{ id: string; edition: string; status: string; signed_claims: string; valid_from: Date; valid_until: Date; grace_until: Date; entitlement_version_id: string; issued_by: string }>(
        'select id, edition, status, signed_claims, valid_from, valid_until, grace_until, entitlement_version_id, issued_by from machvon.license_revision where tenant_id = $1',
      );
      expect(license).toMatchObject({ edition: 'PILOT', status: 'Issued', issued_by: REQUESTER });
      expect(Math.round(((license?.valid_until.getTime() ?? 0) - (license?.valid_from.getTime() ?? 0)) / DAY_MS)).toBe(TRIAL_DAYS);
      expect(Math.round(((license?.grace_until.getTime() ?? 0) - (license?.valid_until.getTime() ?? 0)) / DAY_MS)).toBe(30);
      expect(verifyLicenseToken(license?.signed_claims ?? '', await keys.publicKeys(), tenantId).valid).toBe(true);
      expect(await sql<{ n: number }>("select count(*)::int as n from machvon.role_definition where tenant_id = $1 and is_system")).toEqual([{ n: SYSTEM_ROLES.length }]);
      expect(await sql("select code, name, unit_type, depth, parent_id from machvon.organization_unit where tenant_id = $1")).toEqual([
        { code: 'ROOT', name: 'Ủy ban nhân dân tỉnh Kiểm Thử', unit_type: 'GOVERNING_BODY', depth: 0, parent_id: null },
      ]);
      expect(await sql("select version::int as version, config_json->>'name' as name from machvon.tenant_theme_version where tenant_id = $1")).toEqual([{ version: 1, name: detail?.tenant.name }]);
      expect(await sql("select current_version::int as v from machvon.tenant_theme_pointer where tenant_id = $1")).toEqual([{ v: 1 }]);

      // The owner: invited into the root unit with the grant, one pending invitation whose token went to the mailer and only its hash is stored.
      expect(await sql("select status from machvon.membership where tenant_id = $1")).toEqual([{ status: 'Invited' }]);
      expect(await sql("select r.code, g.status from machvon.role_grant g join machvon.role_definition r on r.tenant_id = g.tenant_id and r.id = g.role_id where g.tenant_id = $1 and r.code = 'TENANT_OWNER'")).toEqual([{ code: 'TENANT_OWNER', status: 'Active' }]);
      const message = mailer.lastTo('owner.one@example.org');
      expect(message).toMatchObject({ tenantId });
      const stored = await sql<{ token_hash: string; status: string }>("select token_hash, status from machvon.membership_invitation where tenant_id = $1");
      expect(stored).toEqual([{ token_hash: createHash('sha256').update(message?.token ?? '').digest('hex'), status: 'Pending' }]);

      // The record: audit rows and events of the steps and of the activation, none with a token, a key or an email.
      expect((await sql<{ action: string }>("select action from machvon.audit_event where tenant_id = $1 and outcome = 'SUCCESS' order by occurred_at")).map((row) => row.action)).toEqual([
        'license.issued',
        'tenant.owner_assigned',
        'tenant.activated',
      ]);
      const types = (await sql<{ type: string }>('select type from machvon.outbox_event where tenant_id = $1 order by created_at, id')).map((row) => row.type);
      for (const wanted of ['sas.entitlement.changed.v1', 'sas.license.issued.v1', 'iam.role_grant.created.v1', 'iam.membership.invited.v1', 'iam.access.changed.v1', 'sas.tenant.status_changed.v1']) expect(types).toContain(wanted);
      expect(await sql("select payload from machvon.outbox_event where tenant_id = $1 and type = 'sas.tenant.status_changed.v1'")).toEqual([{ payload: { tenant_id: tenantId, from: 'Provisioning', to: 'Active' } }]);
      const dump = JSON.stringify(await sql("select to_jsonb(a) as doc from machvon.audit_event a where tenant_id = $1 union all select to_jsonb(e) from machvon.outbox_event e where tenant_id = $1"));
      expect(dump).not.toContain(message?.token ?? 'missing');
      expect(dump).not.toContain('owner.one@example.org');
      expect(dump).not.toContain(license?.signed_claims ?? 'missing');
    });

    it('treats a redelivery of a finished run as done: nothing runs again', async () => {
      const { tenantId } = await requested();
      await saga().run(tenantId, 1);
      const before = await footprint(tenantId);
      const sent = mailer.sent.length;
      expect(await saga().run(tenantId, 1)).toBe('Completed');
      expect(await footprint(tenantId)).toEqual(before);
      expect(mailer.sent).toHaveLength(sent);
    });

    it('never makes the tenant Active while a step is still to run: a saga with the first ten steps leaves it Provisioning', async () => {
      const { tenantId } = await requested();
      const partial = new ProvisioningSaga(harness.registry, ports, { steps: createProvisioningSteps(services).slice(0, 10), onCompleted: activationRecorder(services), delay: () => Promise.resolve() });
      expect(await partial.run(tenantId, 1)).toBe('Completed');
      expect((await harness.registry.getTenant(tenantId))?.status).toBe('Provisioning');
      expect((await harness.registry.loadRun(tenantId, 1))?.currentStep).toBe('OWNER_INVITE');
      expect(await stepStatus(tenantId, 'OWNER_INVITE')).toMatchObject({ status: 'PENDING' });
      expect(await saga().run(tenantId, 1)).toBe('Completed');
      expect((await harness.registry.getTenant(tenantId))?.status).toBe('Active');
    });
  });

  describe('a process that dies', () => {
    it.each(LATER_STEPS.map((step) => [step] as const))('after %s ran but before it was recorded: the resumed run finishes with exactly what a clean run leaves', async (step) => {
      const baseline = await requested();
      await saga().run(baseline.tenantId, 1);
      const clean = await footprint(baseline.tenantId);

      const { tenantId } = await requested();
      let armed = true;
      // The registry the dying runner uses loses the process while it records that `step` is DONE: its effects are in the database, the record is not.
      const dying = Object.create(harness.registry) as TenantRegistry;
      dying.updateStep = async (...args: Parameters<TenantRegistry['updateStep']>): Promise<void> => {
        if (armed && args[2] === step && args[3].status === 'DONE') {
          armed = false;
          throw new Error('the process died');
        }
        return harness.registry.updateStep(...args);
      };
      await expect(saga({ registry: dying, delay: () => Promise.reject(new Crash('runner killed')) }).run(tenantId, 1)).rejects.toBeInstanceOf(Crash);
      expect(await stepStatus(tenantId, step)).toMatchObject({ status: 'RUNNING' });
      expect((await harness.registry.getTenant(tenantId))?.status).toBe('Provisioning');

      expect(await saga().run(tenantId, 1)).toBe('Completed');
      expect((await harness.registry.getTenant(tenantId))?.status).toBe('Active');
      expect(await footprint(tenantId)).toEqual(clean);
      for (const each of PROVISIONING_STEPS) expect(await stepStatus(tenantId, each)).toMatchObject({ status: 'DONE' });
    });

    it('resumes from the first step that is not DONE when the runner stopped between two steps, and runs no finished step again', async () => {
      const { tenantId } = await requested();
      const first = new ProvisioningSaga(harness.registry, ports, { steps: createProvisioningSteps(services).slice(0, 8), delay: () => Promise.resolve() });
      await first.run(tenantId, 1);
      const licensesBefore = await count('select count(*) as n from machvon.license_revision where tenant_id = $1', tenantId);
      const versions = await count('select count(*) as n from machvon.entitlement_version where tenant_id = $1', tenantId);
      expect(await saga().run(tenantId, 1)).toBe('Completed');
      expect(await count('select count(*) as n from machvon.license_revision where tenant_id = $1', tenantId)).toBe(licensesBefore);
      expect(await count('select count(*) as n from machvon.entitlement_version where tenant_id = $1', tenantId)).toBe(versions);
      expect((await stepStatus(tenantId, 'ENTITLEMENT_V1'))?.attempts).toBe(1);
    });
  });

  describe('a step that fails', () => {
    const failing = (step: (typeof PROVISIONING_STEPS)[number], failure: () => Error): ProvisioningServices => ({
      ...services,
      bootstrap: Object.assign(Object.create(services.bootstrap) as TenantBootstrapStore, {
        ensureRootUnit: (...args: Parameters<TenantBootstrapStore['ensureRootUnit']>) => (step === 'ROOT_UNIT' ? Promise.reject(failure()) : services.bootstrap.ensureRootUnit(...args)),
      }),
    });

    it('stops at step 9 with the run and the tenant Failed, keeps steps 6 to 8, and a retry starts there without repeating them', async () => {
      const { tenantId } = await requested();
      const outcome = await saga({ services: failing('ROOT_UNIT', () => new DomainError('VALIDATION_FAILED', 422, 'root_unit_name')) }).run(tenantId, 1);
      expect(outcome).toBe('Failed');
      expect((await harness.registry.getTenant(tenantId))?.status).toBe('Failed');
      expect(await stepStatus(tenantId, 'ROOT_UNIT')).toMatchObject({ status: 'FAILED', error_code: 'VALIDATION_FAILED' });
      for (const step of ['ENTITLEMENT_V1', 'LICENSE_PILOT', 'ROLE_SEED'] as const) expect(await stepStatus(tenantId, step)).toMatchObject({ status: 'DONE' });
      for (const step of ['THEME_V1', 'OWNER_INVITE'] as const) expect(await stepStatus(tenantId, step)).toMatchObject({ status: 'PENDING' });
      expect(mailer.lastTo((await harness.registry.getDetail(tenantId))?.run?.request.initial_owner_email ?? '')).toBeUndefined();

      const tenant = await harness.registry.getTenant(tenantId);
      const retry = await harness.control.withTenantOf(PLATFORM_TENANT_ID, (tx) => harness.registry.startRetryRun(tx, tenantId, tenant?.version ?? 0, REQUESTER, PLATFORM_TENANT_ID, () => Promise.resolve()));
      expect(retry.attempt).toBe(2);
      expect(await saga().run(tenantId, 2)).toBe('Completed');
      expect((await harness.registry.getTenant(tenantId))?.status).toBe('Active');
      expect(await count('select count(*) as n from machvon.license_revision where tenant_id = $1', tenantId)).toBe(1);
      expect(await count('select count(*) as n from machvon.role_definition where tenant_id = $1', tenantId)).toBe(SYSTEM_ROLES.length);
      const run = await harness.registry.loadRun(tenantId, 2);
      expect(run?.steps.ENTITLEMENT_V1.attempts).toBe(1);
      expect(run?.steps.ROOT_UNIT).toMatchObject({ status: 'DONE', attempts: 1 });
    });

    it('retries an infrastructure failure of the mailer after 10 s and sends one invitation that is pending', async () => {
      const { tenantId } = await requested({ initialOwnerEmail: 'retry.owner@example.org' });
      let failures = 1;
      const flaky: ProvisioningServices = {
        ...services,
        mailer: {
          send: (message) => {
            if (failures > 0) {
              failures -= 1;
              return Promise.reject(Object.assign(new Error('smtp down'), { code: 'MAIL_UNAVAILABLE' }));
            }
            return mailer.send(message);
          },
        },
      };
      expect(await saga({ services: flaky }).run(tenantId, 1)).toBe('Completed');
      expect(delays).toEqual([10]);
      expect((await stepStatus(tenantId, 'OWNER_INVITE'))?.attempts).toBe(2);
      expect((await footprint(tenantId)).pending).toBe(1);
      expect(await count("select count(*) as n from machvon.membership_invitation where tenant_id = $1 and status = 'Revoked'", tenantId)).toBe(1);
      expect(mailer.lastTo('retry.owner@example.org')).toBeDefined();
    });

    it('fails step 7 without a signing key, and finishes when a retry finds one', async () => {
      const { tenantId } = await requested();
      keys.available = false;
      expect(await saga().run(tenantId, 1)).toBe('Failed');
      expect(await stepStatus(tenantId, 'LICENSE_PILOT')).toMatchObject({ status: 'FAILED', error_code: 'SIGNING_KEY_UNAVAILABLE' });
      expect(await count('select count(*) as n from machvon.license_revision where tenant_id = $1', tenantId)).toBe(0);
      keys.available = true;
      const tenant = await harness.registry.getTenant(tenantId);
      await harness.control.withTenantOf(PLATFORM_TENANT_ID, (tx) => harness.registry.startRetryRun(tx, tenantId, tenant?.version ?? 0, REQUESTER, PLATFORM_TENANT_ID, () => Promise.resolve()));
      expect(await saga().run(tenantId, 2)).toBe('Completed');
      expect(await count('select count(*) as n from machvon.license_revision where tenant_id = $1', tenantId)).toBe(1);
    });
  });

  describe('provisioning cancelled', () => {
    it('undoes the steps in reverse order: the owner invitation and the license are revoked, the rest stays with the tenant', async () => {
      const { tenantId } = await requested();
      await saga().run(tenantId, 1);
      const order: string[] = [];
      const watching = Object.create(harness.registry) as TenantRegistry;
      watching.updateStep = (...args: Parameters<TenantRegistry['updateStep']>): Promise<void> => {
        if (args[3].status === 'COMPENSATED') order.push(args[2]);
        return harness.registry.updateStep(...args);
      };
      await saga({ registry: watching }).compensate(tenantId, 1);
      expect(order).toEqual([...PROVISIONING_STEPS].reverse());
      expect(await harness.count("select count(*) as n from machvon.license_revision where tenant_id = $1 and status = 'Revoked'", [tenantId])).toBe(1);
      expect(await harness.count("select count(*) as n from machvon.membership_invitation where tenant_id = $1 and status = 'Pending'", [tenantId])).toBe(0);
      expect(await harness.count("select count(*) as n from machvon.membership where tenant_id = $1 and status = 'Ended'", [tenantId])).toBe(1);
      expect(await harness.count("select count(*) as n from machvon.audit_event where tenant_id = $1 and action = 'license.revoked'", [tenantId])).toBe(1);
      expect(await footprint(tenantId)).toMatchObject({ roles: SYSTEM_ROLES.length, units: 1, themes: 1 });
    });

    it('leaves steps that never ran alone, and revokes nothing for a tenant that has no license yet', async () => {
      const { tenantId } = await requested();
      const partial = new ProvisioningSaga(harness.registry, ports, { steps: createProvisioningSteps(services).slice(0, 6), delay: () => Promise.resolve() });
      await partial.run(tenantId, 1);
      await saga().compensate(tenantId, 1);
      expect(await stepStatus(tenantId, 'LICENSE_PILOT')).toMatchObject({ status: 'PENDING' });
      expect(await stepStatus(tenantId, 'ENTITLEMENT_V1')).toMatchObject({ status: 'COMPENSATED' });
      expect(await harness.count('select count(*) as n from machvon.audit_event where tenant_id = $1', [tenantId])).toBe(0);
    });
  });

  describe('the owner step on its own', () => {
    it('sends nothing when the person already owns the tenant', async () => {
      const { tenantId } = await requested({ initialOwnerEmail: 'accepted.owner@example.org' });
      await saga().run(tenantId, 1);
      await harness.admin((client) => client.query("update machvon.membership set status = 'Active' where tenant_id = $1", [tenantId]));
      const detail = await harness.registry.getDetail(tenantId);
      const sent = mailer.sent.length;
      const step = provisioningStepDefinitions(services).find((definition) => definition.step === 'OWNER_INVITE');
      if (detail?.run === undefined || step === undefined) throw new Error('run or step missing');
      await step.execute({ tenant: detail.tenant, run: detail.run, ports, registry: harness.registry });
      expect(mailer.sent).toHaveLength(sent);
      expect((await footprint(tenantId)).memberships).toBe(1);
    });

    it('lets any other refusal of the step stand', async () => {
      const { tenantId } = await requested({ initialOwnerEmail: 'suspended.owner@example.org' });
      await saga().run(tenantId, 1);
      await harness.admin((client) => client.query("update machvon.membership set status = 'Suspended' where tenant_id = $1", [tenantId]));
      const detail = await harness.registry.getDetail(tenantId);
      const step = provisioningStepDefinitions(services).find((definition) => definition.step === 'OWNER_INVITE');
      if (detail?.run === undefined || step === undefined) throw new Error('run or step missing');
      await expect(step.execute({ tenant: detail.tenant, run: detail.run, ports, registry: harness.registry })).rejects.toMatchObject({ code: 'MEMBERSHIP_STATE_INVALID' });
    });

    it('seeds a first theme that the theme validation accepts', () => {
      expect(() => assertValidTheme(defaultTenantTheme('Cao Bằng') as unknown as Parameters<typeof assertValidTheme>[0])).not.toThrow();
      expect(defaultTenantTheme('Cao Bằng')).toMatchObject({ name: 'Cao Bằng', header: 'Cao Bằng', logoAssetId: null });
    });
  });
});
