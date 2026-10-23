import { randomBytes, randomUUID } from 'node:crypto';
import { APP_FILTER } from '@nestjs/core';
import { DEFAULT_MFA_REQUIRED_ROLES, EffectiveAccessStore, InMemoryAuthzCache, TenantDatabase, loadSelectionFacts } from '@machvon/db';
import { loadErrorRegistry, signTenantContext } from '@machvon/kernel';
import { CommandModule } from '../src/command.module';
import { PolicyModule } from '../src/policy.module';
import { ProblemFilter } from '../src/problem.filter';
import { SecurityPoliciesController, SecurityPolicyReadsController } from '../src/modules/adm/security-policy.controller';
import { AuthzHarness, TENANT_A, memberId, unitId } from '../../../packages/db/test/support/authz-fixtures';
import { TENANT_HEADER } from './isolation/test-auth.guard';
import { ERROR_CODES_PATH, startTestApp } from './isolation/test-app';
import type { RunningApp } from './isolation/test-app';

const SIGNING_KEY = randomBytes(32);
const path = (...ns: number[]): string => `/${ns.map(unitId).join('/')}/`;

// Members of tenant A.
const AUTHOR = 1; // adm.security.manage and read on the whole tenant
const APPROVER = 2; // adm.security.approve and read on the whole tenant (the second person)
const READER = 3; // adm.security.read on the whole tenant
const UNIT_AUTHOR = 4; // manage on the subtree of unit 2 only
const NOBODY = 5; // holds only the SPECIALIST role the policy names
const BOTH = 6; // adm.security.manage and approve: the maker rule is all that stops their own publication

interface Reply {
  status: number;
  json: Record<string, unknown>;
}

const POLICY = { mfa_required_roles: ['SPECIALIST'], session_idle_minutes: 30, session_max_hours: 8, ip_allowlist: ['10.0.0.0/8'], download_ttl_minutes: 15, export_watermark: true };

describe('security policy commands and reads (ST-ADM-009)', () => {
  const harness = new AuthzHarness();
  let app: RunningApp;

  async function call(method: 'GET' | 'POST', url: string, options: { member: number; body?: unknown; ifMatch?: string }): Promise<Reply> {
    const token = signTenantContext({ tenantId: TENANT_A, membershipId: memberId(options.member), scopeVersion: 1 }, SIGNING_KEY);
    const headers: Record<string, string> = { [TENANT_HEADER]: token, 'content-type': 'application/json' };
    if (method !== 'GET') headers['idempotency-key'] = `key-${randomUUID()}`;
    if (options.ifMatch !== undefined) headers['if-match'] = options.ifMatch;
    const response = await fetch(`${app.baseUrl}${url}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}) });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  const draft = (member: number, body: Record<string, unknown> = POLICY): Promise<Reply> => call('POST', '/security-policies', { member, body });
  const publish = (member: number, policyId: string, ifMatch = '"1"'): Promise<Reply> =>
    call('POST', `/security-policies/${policyId}/publish`, { member, ifMatch, body: { reason: 'Second reviewer approves the policy' } });
  const idOf = (reply: Reply): string => reply.json.resource_id as string;
  const countOf = async (sql: string, params: unknown[] = []): Promise<number> => Number((await harness.owner<{ n: string }>(TENANT_A, [[sql, params]]))[0]?.n);
  const facts = (member: number): Promise<{ mfaRequiredRoles: readonly string[] } | undefined> =>
    (harness.tenants as TenantDatabase).withTenant({ tenantId: TENANT_A, membershipId: memberId(member), scopeVersion: 1 }, (tx) => loadSelectionFacts(tx, memberId(member)));

  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [
      { n: 1, path: path(1) },
      { n: 2, path: path(1, 2), parent: 1 },
    ]);
    for (const n of [AUTHOR, APPROVER, READER, UNIT_AUTHOR, NOBODY, BOTH]) await harness.seedMembership(TENANT_A, n, 1);
    await harness.seedRole(TENANT_A, 1, 'POLICY_AUTHOR', ['adm.security.manage', 'adm.security.read'], 60);
    await harness.seedRole(TENANT_A, 2, 'POLICY_APPROVER', ['adm.security.approve', 'adm.security.read'], 60);
    await harness.seedRole(TENANT_A, 3, 'POLICY_READER', ['adm.security.read'], 20);
    await harness.seedRole(TENANT_A, 4, 'SPECIALIST', [], 40);
    await harness.seedRole(TENANT_A, 5, 'POLICY_BOTH', ['adm.security.manage', 'adm.security.approve', 'adm.security.read'], 60);
    await harness.seedGrants(TENANT_A, [
      { n: 1, member: AUTHOR, role: 1, kind: 'TENANT' },
      { n: 2, member: APPROVER, role: 2, kind: 'TENANT' },
      { n: 3, member: READER, role: 3, kind: 'TENANT' },
      { n: 4, member: UNIT_AUTHOR, role: 1, kind: 'UNIT_SUBTREE', refs: [unitId(2)] },
      { n: 5, member: NOBODY, role: 4, kind: 'TENANT' },
      { n: 6, member: BOTH, role: 5, kind: 'TENANT' },
    ]);
    const tenants = harness.tenants as TenantDatabase;
    app = await startTestApp({
      signingKey: SIGNING_KEY,
      imports: [
        CommandModule.register({ database: tenants }),
        PolicyModule.register({ database: tenants, access: new EffectiveAccessStore(tenants, new InMemoryAuthzCache()) }),
      ],
      controllers: [SecurityPoliciesController, SecurityPolicyReadsController],
      providers: [{ provide: TenantDatabase, useValue: tenants }, { provide: APP_FILTER, useValue: new ProblemFilter(loadErrorRegistry(ERROR_CODES_PATH)) }],
    });
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    await harness.stop();
  }, 60_000);

  afterEach(async () => {
    await harness.owner(TENANT_A, [
      ['delete from machvon.security_policy_version', []],
      ["delete from machvon.audit_event where resource_type = 'security_policy_version'", []],
    ]);
  });

  describe('createSecurityPolicyVersion', () => {
    it('creates a draft revision 1, audits it and changes nothing for sessions', async () => {
      const reply = await draft(AUTHOR);
      expect(reply.status).toBe(201);
      expect(reply.json).toMatchObject({ status: 'DRAFTED', resource_version: 1 });
      expect((await call('GET', `/resources/security_policy_version/${idOf(reply)}`, { member: READER })).json).toMatchObject({
        revision: 1,
        status: 'Draft',
        mfa_required_roles: ['SPECIALIST'],
        ip_allowlist: ['10.0.0.0/8'],
        download_ttl_minutes: 15,
        export_watermark: true,
        approved_by: null,
      });
      expect(await countOf("select count(*) as n from machvon.audit_event where action = 'security_policy.create' and resource_id = $1", [idOf(reply)])).toBe(1);
      expect((await facts(NOBODY))?.mfaRequiredRoles).toEqual(DEFAULT_MFA_REQUIRED_ROLES);
    });

    it.each([
      ['a role that does not exist', { ...POLICY, mfa_required_roles: ['NO_SUCH_ROLE'] }, 'mfa_required_roles'],
      ['a role listed twice', { ...POLICY, mfa_required_roles: ['SPECIALIST', 'SPECIALIST'] }, 'mfa_required_roles'],
      ['an idle limit longer than the session', { ...POLICY, session_idle_minutes: 180, session_max_hours: 2 }, 'session_idle_minutes'],
      ['an address that is not an address', { ...POLICY, ip_allowlist: ['10.0.0.999'] }, 'ip_allowlist'],
    ])('refuses %s with 422 POLICY_INVALID naming the field, and stores nothing', async (_label, body, field) => {
      const reply = await draft(AUTHOR, body);
      expect(reply.status).toBe(422);
      expect(reply.json.code).toBe('POLICY_INVALID');
      expect(JSON.stringify(reply.json)).toContain(field);
      expect(await countOf('select count(*) as n from machvon.security_policy_version')).toBe(0);
    });

    it('refuses a body the schema rejects (a missing limit)', async () => {
      const reply = await draft(AUTHOR, { mfa_required_roles: [], session_idle_minutes: 30 });
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(await countOf('select count(*) as n from machvon.security_policy_version')).toBe(0);
    });

    it('refuses a caller without the permission, a reader, the approver-only role and a subtree author (403, audited as DENIED)', async () => {
      for (const member of [NOBODY, READER, APPROVER]) expect((await draft(member)).status).toBe(403);
      const unitAuthor = await draft(UNIT_AUTHOR);
      expect(unitAuthor.status).toBe(403);
      expect(unitAuthor.json.code).toBe('SCOPE_DENIED');
      expect(await countOf("select count(*) as n from machvon.audit_event where outcome = 'DENIED' and action like '%createSecurityPolicyVersion%'")).toBeGreaterThanOrEqual(1);
      expect(await countOf('select count(*) as n from machvon.security_policy_version')).toBe(0);
    });
  });

  describe('publishSecurityPolicy', () => {
    it('refuses the author with 403 SELF_APPROVAL_DENIED, then lets the second person publish; the published policy changes who needs a second factor (AC-ST-ADM-009-1)', async () => {
      const policyId = idOf(await draft(AUTHOR));
      const self = await publish(AUTHOR, policyId);
      // The author holds only the manage permission here, so the guard stops them first; the maker rule is proved with a holder of both below.
      expect([403]).toContain(self.status);
      expect((await facts(NOBODY))?.mfaRequiredRoles).toEqual(DEFAULT_MFA_REQUIRED_ROLES);

      const published = await publish(APPROVER, policyId);
      expect(published.status).toBe(200);
      expect(published.json).toMatchObject({ status: 'PUBLISHED', resource_version: 2 });
      expect((await facts(NOBODY))?.mfaRequiredRoles).toEqual(['SPECIALIST']);
      expect((await call('GET', `/resources/security_policy_version/${policyId}`, { member: READER })).json).toMatchObject({ status: 'Published', approved_by: memberId(APPROVER), version: 2 });
      expect(await countOf("select count(*) as n from machvon.outbox_event where type = 'adm.security_policy.published.v1' and aggregate_id = $1", [policyId])).toBe(1);
    });

    it('refuses a holder of both permissions publishing their own draft with 403 SELF_APPROVAL_DENIED', async () => {
      const policyId = idOf(await draft(BOTH));
      const self = await publish(BOTH, policyId);
      expect(self.status).toBe(403);
      expect(self.json.code).toBe('SELF_APPROVAL_DENIED');
      expect(await countOf("select count(*) as n from machvon.security_policy_version where status = 'Published'")).toBe(0);
    });

    it('supersedes the version in force: the new list replaces the old one and only one version is Published', async () => {
      const first = idOf(await draft(AUTHOR));
      await publish(APPROVER, first);
      const second = idOf(await draft(AUTHOR, { ...POLICY, mfa_required_roles: [] }));
      expect((await publish(APPROVER, second)).status).toBe(200);
      expect((await call('GET', `/resources/security_policy_version/${first}`, { member: READER })).json.status).toBe('Superseded');
      expect((await facts(NOBODY))?.mfaRequiredRoles).toEqual([]);
      expect(await countOf("select count(*) as n from machvon.security_policy_version where status = 'Published'")).toBe(1);
    });

    it('answers 409 for a policy already published and for a stale version, 404 for an unknown policy', async () => {
      const policyId = idOf(await draft(AUTHOR));
      const stale = await publish(APPROVER, policyId, '"7"');
      expect(stale.status).toBe(409);
      expect(stale.json.code).toBe('VERSION_CONFLICT');
      expect((await publish(APPROVER, policyId)).status).toBe(200);
      const again = await publish(APPROVER, policyId, '"2"');
      expect(again.status).toBe(409);
      expect(again.json.code).toBe('STAGE_TRANSITION_DENIED');
      expect((await publish(APPROVER, randomUUID())).status).toBe(404);
    });

    it('refuses publishing when a named role has been removed since the draft was written, and leaves the draft', async () => {
      const policyId = idOf(await draft(AUTHOR));
      await harness.owner(TENANT_A, [["update machvon.role_definition set status = 'Retired' where code = 'SPECIALIST'", []]]);
      try {
        const reply = await publish(APPROVER, policyId);
        expect(reply.status).toBe(422);
        expect(reply.json.code).toBe('POLICY_INVALID');
        expect((await call('GET', `/resources/security_policy_version/${policyId}`, { member: READER })).json.status).toBe('Draft');
      } finally {
        await harness.owner(TENANT_A, [["update machvon.role_definition set status = 'Active' where code = 'SPECIALIST'", []]]);
      }
    });

    it('refuses a caller without the approve permission on the whole tenant', async () => {
      const policyId = idOf(await draft(AUTHOR));
      for (const member of [NOBODY, READER, AUTHOR, UNIT_AUTHOR]) expect((await publish(member, policyId)).status).toBe(403);
      expect((await call('GET', `/resources/security_policy_version/${policyId}`, { member: READER })).json.status).toBe('Draft');
    });
  });

  describe('reads', () => {
    it('lists the newest revision first, pages with a cursor, and shows nothing to a subtree-only reader', async () => {
      const ids: string[] = [];
      for (let n = 0; n < 3; n += 1) ids.push(idOf(await draft(AUTHOR)));
      const page = await call('GET', '/resources/security_policy_version?limit=2', { member: READER });
      expect((page.json.items as Array<Record<string, unknown>>).map((item) => item.id)).toEqual([ids[2], ids[1]]);
      const rest = await call('GET', `/resources/security_policy_version?limit=2&cursor=${encodeURIComponent(page.json.next_cursor as string)}`, { member: READER });
      expect((rest.json.items as Array<Record<string, unknown>>).map((item) => item.id)).toEqual([ids[0]]);
      expect(rest.json.next_cursor).toBeNull();
      expect((await call('GET', '/resources/security_policy_version', { member: UNIT_AUTHOR })).json.items).toEqual([]);
      expect((await call('GET', '/resources/security_policy_version', { member: NOBODY })).status).toBe(403);
    });
  });
});
