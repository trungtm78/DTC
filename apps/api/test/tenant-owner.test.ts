import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import {
  AuditWriter,
  EffectiveAccessStore,
  EntitlementStore,
  InMemoryAuthzCache,
  InMemoryEntitlementCache,
  LicenseStore,
  PLATFORM_TENANT_ID,
  TenantBootstrapStore,
  ThemeStore,
} from '@machvon/db';
import { loadErrorRegistry, signTenantContext } from '@machvon/kernel';
import { AppModule } from '../src/app.module';
import { INVITATION_MAILER } from '../src/modules/adm/invitation-mailer';
import type { MockInvitationMailer } from '../src/modules/adm/invitation-mailer';
import { Ed25519LicenseSigner } from '../src/modules/sas/license-signer';
import type { LicenseKeyStore } from '../src/modules/sas/license-signer';
import { activationRecorder, createProvisioningSteps } from '../src/provisioning/provisioning-steps';
import type { ProvisioningServices } from '../src/provisioning/provisioning-steps';
import { ProvisioningSaga } from '../src/provisioning/saga';
import { MockProvisioningPorts } from '../src/provisioning/mock-ports';
import { CONTROL_OPERATIONS, controlCasesFor } from './authz/control-matrix';
import { CLAIMS_HEADER, TENANT_HEADER } from './isolation/test-auth.guard';
import { ERROR_CODES_PATH, startTestApp } from './isolation/test-app';
import type { RunningApp } from './isolation/test-app';
import { ProvisioningHarness } from './provisioning/provisioning-fixtures';

const SIGNING_KEY = randomBytes(32);
const CONTROL_MEMBER = '00000000-0000-4000-8000-0000000000c9';
const STANDARD_PLAN = '00000000-0000-4000-9000-000000000001';
const KEY_ID = 'kid-owner';
const DAY_MS = 86_400_000;
const REASON = 'The agency asked for a new owner in writing.';
const DOCUMENT = 'CV-2026/0042';

interface Reply {
  status: number;
  headers: Headers;
  json: Record<string, unknown>;
}

describe('assignTenantOwner over HTTP (ST-SAS-006, BR-IAM-05)', () => {
  const harness = new ProvisioningHarness();
  let app: RunningApp;
  let mailer: MockInvitationMailer;
  let services: ProvisioningServices;
  let counter = 0;

  async function call(path: string, options: { roles?: string[]; audience?: string; payload?: unknown; key?: string } = {}): Promise<Reply> {
    const token = signTenantContext({ tenantId: PLATFORM_TENANT_ID, membershipId: CONTROL_MEMBER, scopeVersion: 0 }, SIGNING_KEY);
    const response = await fetch(`${app.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        [TENANT_HEADER]: token,
        [CLAIMS_HEADER]: JSON.stringify({ aud: options.audience ?? 'control', roles: options.roles ?? ['SystemAdmin'] }),
        'content-type': 'application/json',
        'idempotency-key': options.key ?? `key-${randomUUID()}`,
      },
      body: JSON.stringify(options.payload ?? {}),
    });
    return { status: response.status, headers: response.headers, json: (await response.json()) as Record<string, unknown> };
  }

  const bodyOf = (email: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ user_email: email, request_document_ref: DOCUMENT, reason: REASON, ...overrides });
  const assign = (tenantId: string, email: string, options: { roles?: string[]; audience?: string; key?: string; payload?: Record<string, unknown> } = {}): Promise<Reply> =>
    call(`/system/tenants/${tenantId}/owners`, { ...options, payload: options.payload ?? bodyOf(email) });

  /** A tenant that went through the whole saga: Active, with its roles and root unit, and the first owner pending. */
  async function provisioned(): Promise<string> {
    counter += 1;
    const created = await harness.request({ planVersionId: STANDARD_PLAN, initialOwnerEmail: `first.owner${counter}@example.org` });
    const saga = new ProvisioningSaga(harness.registry, new MockProvisioningPorts(), { steps: createProvisioningSteps(services), onCompleted: activationRecorder(services), delay: () => Promise.resolve() });
    expect(await saga.run(created.tenantId, 1)).toBe('Completed');
    return created.tenantId;
  }

  const sql = <T extends object>(text: string, params: unknown[]): Promise<T[]> => harness.admin((client) => client.query<T>(text, params).then((result) => result.rows));
  const pending = (tenantId: string): Promise<number> => harness.count("select count(*) as n from machvon.membership_invitation where tenant_id = $1 and status = 'Pending'", [tenantId]);

  beforeAll(async () => {
    await harness.start();
    const pair = generateKeyPairSync('ed25519');
    const keys: LicenseKeyStore = {
      current: () => Promise.resolve(new Ed25519LicenseSigner(KEY_ID, pair.privateKey)),
      publicKeys: () => Promise.resolve(new Map([[KEY_ID, pair.publicKey.export({ format: 'der', type: 'spki' })]])),
    };
    const entitlements = new EntitlementStore(harness.tenants, new InMemoryEntitlementCache());
    const licenses = new LicenseStore(entitlements);
    await harness.control.withControl((tx) =>
      licenses.registerSigningKey(tx, { keyId: KEY_ID, publicKeyPem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(), kmsKeyRef: 'test', notBefore: new Date(Date.now() - 30 * DAY_MS), notAfter: new Date(Date.now() + 730 * DAY_MS) }),
    );
    services = {
      control: harness.control,
      entitlements,
      licenses,
      keys,
      themes: new ThemeStore(),
      bootstrap: new TenantBootstrapStore(),
      audit: new AuditWriter(harness.tenants),
      mailer: { send: () => Promise.resolve() },
    };
    app = await startTestApp({
      signingKey: SIGNING_KEY,
      imports: [
        AppModule.register({
          database: harness.tenants,
          registry: loadErrorRegistry(ERROR_CODES_PATH),
          policy: { database: harness.tenants, access: new EffectiveAccessStore(harness.tenants, new InMemoryAuthzCache()) },
          control: { database: harness.control, registry: harness.registry },
        }),
      ],
    });
    mailer = app.get<MockInvitationMailer>(INVITATION_MAILER);
    // The first owner of a provisioned tenant is mailed through the same mock, so the tests see both messages.
    services.mailer = mailer;
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    await harness.stop();
  }, 60_000);

  it('invites the person as owner: 201 with the CommandResult, one pending invitation, and the token goes to the mailer only', async () => {
    const tenantId = await provisioned();
    const reply = await assign(tenantId, 'New.Owner@Example.org');
    expect(reply.status).toBe(201);
    expect(reply.json).toMatchObject({ status: 'OWNER_ASSIGNED' });
    expect(await pending(tenantId)).toBe(1);
    const message = mailer.lastTo('new.owner@example.org');
    expect(message).toMatchObject({ tenantId });
    expect(await sql('select token_hash from machvon.membership_invitation where tenant_id = $1 and status = $2', [tenantId, 'Pending'])).toEqual([
      { token_hash: createHash('sha256').update(message?.token ?? '').digest('hex') },
    ]);
    const grants = await sql<{ membership_id: string }>("select g.membership_id from machvon.role_grant g join machvon.role_definition r on r.tenant_id = g.tenant_id and r.id = g.role_id where g.tenant_id = $1 and r.code = 'TENANT_OWNER' and g.status = 'Active'", [tenantId]);
    expect(grants.map((grant) => grant.membership_id)).toContain(reply.json.resource_id);
  });

  it('writes the audit row with the reason and the document, and the events, on the tenant, with no email and no token anywhere', async () => {
    const tenantId = await provisioned();
    const before = await harness.count("select count(*) as n from machvon.audit_event where tenant_id = $1 and action = 'tenant.owner_assigned'", [tenantId]);
    const reply = await assign(tenantId, 'audit.owner@example.org');
    const audit = await sql<{ reason: string; safe_diff: Record<string, unknown> }>("select reason, safe_diff from machvon.audit_event where tenant_id = $1 and action = 'tenant.owner_assigned' and outcome = 'SUCCESS' order by occurred_at desc limit 1", [tenantId]);
    expect(audit[0]).toMatchObject({ reason: REASON, safe_diff: { membership_id: reply.json.resource_id, request_document_ref: DOCUMENT } });
    expect(await harness.count("select count(*) as n from machvon.audit_event where tenant_id = $1 and action = 'tenant.owner_assigned'", [tenantId])).toBe(before + 1);
    const types = (await sql<{ type: string }>("select type from machvon.outbox_event where tenant_id = $1 and payload->>'membership_id' = $2", [tenantId, reply.json.resource_id as string])).map((row) => row.type);
    expect(types).toEqual(expect.arrayContaining(['iam.role_grant.created.v1', 'iam.membership.invited.v1', 'iam.access.changed.v1']));
    const dump = JSON.stringify(await sql('select to_jsonb(a) as doc from machvon.audit_event a where tenant_id = $1 union all select to_jsonb(e) from machvon.outbox_event e where tenant_id = $1', [tenantId]));
    expect(dump).not.toContain('audit.owner@example.org');
    expect(dump).not.toContain(mailer.lastTo('audit.owner@example.org')?.token ?? 'missing');
  });

  it('sends the invitation again for the same person: the earlier one is revoked and one is pending', async () => {
    const tenantId = await provisioned();
    const first = await assign(tenantId, 'again.owner@example.org');
    const second = await assign(tenantId, 'again.owner@example.org');
    expect(second.json.resource_id).toBe(first.json.resource_id);
    expect(await pending(tenantId)).toBe(1);
    expect(mailer.sent.filter((message) => message.toEmail === 'again.owner@example.org')).toHaveLength(2);
  });

  it('revokes the pending owner invitation of the person named at provisioning when another person is named', async () => {
    const tenantId = await provisioned();
    const firstEmail = (await harness.registry.getDetail(tenantId))?.run?.request.initial_owner_email ?? '';
    const reply = await assign(tenantId, 'second.owner@example.org');
    expect(reply.status).toBe(201);
    expect(await pending(tenantId)).toBe(1);
    expect(await harness.count("select count(*) as n from machvon.membership where tenant_id = $1 and status = 'Ended' and ended_reason = 'OWNER_REPLACED'", [tenantId])).toBe(1);
    expect(mailer.lastTo(firstEmail)).toBeDefined();
    expect(await harness.count("select count(*) as n from machvon.outbox_event where tenant_id = $1 and type = 'iam.membership.ended.v1'", [tenantId])).toBe(1);
  });

  it('refuses a person who already owns the tenant with 409 MEMBERSHIP_STATE_INVALID', async () => {
    const tenantId = await provisioned();
    await assign(tenantId, 'active.owner@example.org');
    await harness.admin((client) => client.query("update machvon.membership set status = 'Active' where tenant_id = $1 and status = 'Invited' and id in (select membership_id from machvon.membership_invitation where tenant_id = $1 and status = 'Pending')", [tenantId]));
    const refused = await assign(tenantId, 'active.owner@example.org');
    expect([refused.status, refused.json.code]).toEqual([409, 'MEMBERSHIP_STATE_INVALID']);
  });

  it('gives an active member the grant without a message, reports the version the membership has and raises its authorization version', async () => {
    const tenantId = await provisioned();
    const first = await assign(tenantId, 'member.becomes.owner@example.org');
    const membershipId = first.json.resource_id as string;
    // The person accepted the invitation earlier (the version went up with it) and their owner grant was withdrawn since.
    await harness.admin(async (client) => {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      await client.query("update machvon.membership set status = 'Active', version = 5 where id = $1", [membershipId]);
      await client.query("update machvon.role_grant set status = 'Revoked', revoked_at = now(), revoke_reason = 'test' where membership_id = $1", [membershipId]);
      await client.query('commit');
    });
    const scopeVersion = async (): Promise<number> => Number((await sql<{ v: string }>('select scope_version::text as v from machvon.membership where tenant_id = $1 and id = $2', [tenantId, membershipId]))[0]?.v);
    const before = await scopeVersion();
    const sent = mailer.sent.length;
    const reply = await assign(tenantId, 'member.becomes.owner@example.org');
    expect(reply.status).toBe(201);
    expect(reply.json).toMatchObject({ resource_id: membershipId, resource_version: 5 });
    expect(reply.headers.get('etag')).toContain('5');
    expect(await scopeVersion()).toBe(before + 1);
    expect(mailer.sent).toHaveLength(sent);
  });

  it('refuses a tenant that is not provisioned yet with 409, an unknown tenant with 404, and a body the contract does not allow with a validation error', async () => {
    const created = await harness.request({ planVersionId: STANDARD_PLAN });
    const notReady = await assign(created.tenantId, 'early.owner@example.org');
    expect([notReady.status, notReady.json.code]).toEqual([409, 'MEMBERSHIP_STATE_INVALID']);
    expect((await assign('00000000-0000-4000-8000-00000000f997', 'nobody@example.org')).status).toBe(404);
    const tenantId = await provisioned();
    for (const payload of [bodyOf('not an email'), bodyOf('a@example.org', { reason: 'short' }), bodyOf('a@example.org', { request_document_ref: 'x' }), { user_email: 'a@example.org', reason: REASON }, bodyOf('a@example.org', { role: 'TENANT_OWNER' })]) {
      const reply = await assign(tenantId, '', { payload });
      expect([422, 400]).toContain(reply.status);
    }
    expect(await pending(tenantId)).toBe(1);
  });

  it('replays the same key with the stored answer and invites once', async () => {
    const tenantId = await provisioned();
    const key = `key-${randomUUID()}`;
    const first = await assign(tenantId, 'replay.owner@example.org', { key });
    const second = await assign(tenantId, 'replay.owner@example.org', { key });
    expect(second.json).toEqual(first.json);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(mailer.sent.filter((message) => message.toEmail === 'replay.owner@example.org')).toHaveLength(1);
  });

  it('refuses a tenant-plane token, whatever its roles, and changes nothing', async () => {
    const tenantId = await provisioned();
    const reply = await assign(tenantId, 'tenant.token@example.org', { audience: 'tenant', roles: ['TENANT_OWNER', 'SystemAdmin'] });
    expect([reply.status, reply.json.code]).toEqual([403, 'SCOPE_DENIED']);
    expect(mailer.lastTo('tenant.token@example.org')).toBeUndefined();
  });

  describe('generated matrix: the command against every realm role', () => {
    const operations = CONTROL_OPERATIONS.filter((operation) => operation.path.endsWith('/owners'));
    const cases = controlCasesFor(operations);

    it.each(cases.map((matrixCase) => [matrixCase.id, matrixCase] as const))('%s', async (_id, matrixCase) => {
      const tenantId = await provisioned();
      const email = `matrix-${matrixCase.role.toLowerCase()}-${counter}@example.org`;
      const deniedBefore = await harness.count("select count(*) as n from machvon.audit_event where tenant_id = $1 and outcome = 'DENIED' and action = 'authz.denied:assignTenantOwner'", [PLATFORM_TENANT_ID]);
      const reply = await assign(tenantId, email, { roles: [matrixCase.role] });
      if (matrixCase.expected === 'allow') {
        expect(reply.status).toBe(201);
        return;
      }
      expect([reply.status, reply.json.code]).toEqual([403, 'SCOPE_DENIED']);
      expect(await harness.count("select count(*) as n from machvon.audit_event where tenant_id = $1 and outcome = 'DENIED' and action = 'authz.denied:assignTenantOwner'", [PLATFORM_TENANT_ID])).toBe(deniedBefore + 1);
      expect(mailer.lastTo(email)).toBeUndefined();
      expect(await pending(tenantId)).toBe(1);
    });
  });
});
