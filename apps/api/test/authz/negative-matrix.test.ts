import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EffectiveAccessStore, InMemoryAuthzCache, SYSTEM_ROLES, TenantDatabase, seedSystemRoles } from '@machvon/db';
import { loadErrorRegistry, signTenantContext } from '@machvon/kernel';
import type { SystemRole } from '@machvon/db';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, grantId, id, memberId, unitId } from '../../../../packages/db/test/support/authz-fixtures';
import { writeOperationsOf } from '../conformance/command-cases';
import { CLAIMS_HEADER, TENANT_HEADER } from '../isolation/test-auth.guard';
import { ERROR_CODES_PATH, loadOpenApi, startTestApp } from '../isolation/test-app';
import type { RunningApp } from '../isolation/test-app';
import { COMMAND_FIXTURES, evaluateGuardDenial, evaluateWrongTenant, negativeCasesFor, operationsOf } from './negative-matrix';
import type { MatrixCase, MatrixRequest, MatrixTargets, Observation } from './negative-matrix';

const SIGNING_KEY = randomBytes(32);
const ACTOR = '00000000-0000-4000-8000-0000000000f0';
const MATRIX_COMMANDS: string[] = (JSON.parse(readFileSync(join(__dirname, 'matrix-commands.json'), 'utf8')) as { commands: string[] }).commands;

const ROLE_MEMBER_BASE = 10; // member n = ROLE_MEMBER_BASE + index of the role in SYSTEM_ROLES
const RECIPIENT = 5;
const OTHER_TENANT_OWNER = 1;
const CUSTOM_ROLE = 90;
const ONE_GRANT_TO_REVOKE = 900;
const TENANT_A_MARKERS = [unitId(1), unitId(2), unitId(3), memberId(RECIPIENT), grantId(ONE_GRANT_TO_REVOKE), TENANT_A, 'MATRIX_CUSTOM'];

const roleMember = (code: string): number => ROLE_MEMBER_BASE + SYSTEM_ROLES.findIndex((role) => role.code === code);

describe('negative authorization matrix generator', () => {
  const roles: readonly SystemRole[] = SYSTEM_ROLES;

  it('mirrors matrix-commands.json: one fixture per listed command, in the same set', () => {
    expect(Object.keys(COMMAND_FIXTURES).sort()).toEqual([...MATRIX_COMMANDS].sort());
  });

  it('covers every write operation that the real application implements (the list is not hand-kept)', async () => {
    const harness = new AuthzHarness();
    await harness.start();
    try {
      const database = new TenantDatabase(harness.appPool);
      const app = await startTestApp({
        signingKey: SIGNING_KEY,
        imports: [
          AppModule.register({
            database,
            registry: loadErrorRegistry(ERROR_CODES_PATH),
            policy: { database, access: new EffectiveAccessStore(database, new InMemoryAuthzCache()) },
          }),
        ],
      });
      try {
        const writes = new Set(writeOperationsOf(loadOpenApi()).map((operation) => operation.operationId));
        const implementedCommands = [...app.implementedOperations].filter((operationId) => writes.has(operationId)).sort();
        expect(implementedCommands).toEqual([...MATRIX_COMMANDS].sort());
      } finally {
        await app.close();
      }
    } finally {
      await harness.stop();
    }
  }, 180_000);

  it('generates one case per role without the permission, plus a wrong-tenant and a control-plane case, for each command', () => {
    const operations = operationsOf(MATRIX_COMMANDS);
    const cases = negativeCasesFor(operations, roles);
    for (const operation of operations) {
      const mine = cases.filter((matrixCase) => matrixCase.operationId === operation.operationId);
      const roleCases = mine.filter((matrixCase) => matrixCase.kind === 'role').map((matrixCase) => matrixCase.roleCode);
      const holders = roles.filter((role) => role.permissions.some((held) => held === operation.permission || (held.endsWith('.*') && operation.permission.startsWith(held.slice(0, -1)))));
      expect(roleCases.sort()).toEqual(roles.filter((role) => !holders.includes(role)).map((role) => role.code).sort());
      expect(mine.filter((matrixCase) => matrixCase.kind === 'wrong-tenant')).toHaveLength(1);
      expect(mine.filter((matrixCase) => matrixCase.kind === 'control-plane')).toHaveLength(1);
    }
    // TENANT_OWNER holds everything the commands need, so it never appears as a denied role.
    expect(cases.some((matrixCase) => matrixCase.roleCode === 'TENANT_OWNER')).toBe(false);
    expect(new Set(cases.map((matrixCase) => matrixCase.id)).size).toBe(cases.length);
  });

  it('refuses an operation with no permission in the generated table', () => {
    expect(() => operationsOf(['no_such_operation'])).toThrow(/no permission/);
  });

  describe('verdicts (negative controls: a request that gets through turns the matrix red)', () => {
    const refused: Observation = { status: 403, code: 'SCOPE_DENIED', text: '{}', deniedRows: 1, stateChanged: false };

    it('accepts a refusal with its DENIED audit row and an untouched state', () => {
      expect(evaluateGuardDenial(refused)).toEqual([]);
    });

    it('reports a request that the guard let through, with its changed state', () => {
      expect(evaluateGuardDenial({ status: 201, code: undefined, text: '{}', deniedRows: 0, stateChanged: true })).toEqual([
        'answered 201 instead of 403',
        'code undefined instead of SCOPE_DENIED',
        '0 DENIED audit rows instead of 1',
        'tenant state changed',
      ]);
    });

    it('reports a refusal with another code, a missing audit row or a changed state each on its own', () => {
      expect(evaluateGuardDenial({ ...refused, code: 'ROLE_ESCALATION_DENIED' })).toHaveLength(1);
      expect(evaluateGuardDenial({ ...refused, deniedRows: 0 })).toHaveLength(1);
      expect(evaluateGuardDenial({ ...refused, stateChanged: true })).toHaveLength(1);
    });

    it('accepts 403 and 404 for a wrong-tenant caller and reports a success, a leak and a change', () => {
      // A command that names no foreign id may succeed in the caller's own tenant, but must not touch or show tenant A.
      expect(evaluateWrongTenant({ ...refused, status: 201, deniedRows: 0 }, ['abc'], false)).toEqual([]);
      expect(evaluateWrongTenant({ ...refused, status: 201, text: 'ABC', deniedRows: 0, stateChanged: true }, ['abc'], false)).toEqual(['body exposes data of another tenant', 'tenant state changed']);
      expect(evaluateWrongTenant({ ...refused, status: 404, deniedRows: 0 }, ['abc'])).toEqual([]);
      expect(evaluateWrongTenant({ status: 200, code: undefined, text: 'Contains ABC', deniedRows: 0, stateChanged: true }, ['abc'])).toEqual([
        'answered 200 instead of 403 or 404',
        'body exposes data of another tenant',
        'tenant state changed',
      ]);
    });
  });
});

interface Reply {
  status: number;
  json: Record<string, unknown>;
  text: string;
}

describe('negative authorization matrix against the real application (ST-IAM-004 TK-5)', () => {
  const harness = new AuthzHarness();
  let app: RunningApp;
  let targets: MatrixTargets;
  let admin: Client;

  // Only tenant A is fingerprinted: every case must leave it untouched, whoever the caller is.
  const FINGERPRINT = `select md5(concat_ws('|',
    (select string_agg(id::text || path || version::text, ',' order by id) from machvon.organization_unit where tenant_id = $1),
    (select string_agg(id::text || version::text || permissions::text, ',' order by id) from machvon.role_definition where tenant_id = $1),
    (select string_agg(id::text || status || version::text, ',' order by id) from machvon.role_grant where tenant_id = $1),
    (select string_agg(id::text || scope_version::text, ',' order by id) from machvon.membership where tenant_id = $1),
    (select string_agg(id::text || status || version::text || coalesce(read_at::text, '') || coalesce(acknowledged_at::text, ''), ',' order by id) from machvon.notification_instance where tenant_id = $1),
    (select string_agg(id::text || status || version::text, ',' order by id) from machvon.legal_hold where tenant_id = $1),
    (select count(*)::text from machvon.outbox_event where tenant_id = $1))) as fingerprint`;

  const fingerprint = async (): Promise<string> => (await admin.query<{ fingerprint: string }>(FINGERPRINT, [TENANT_A])).rows[0]?.fingerprint ?? '';
  const deniedRows = async (operationId: string, member: string): Promise<number> =>
    Number(
      (
        await admin.query<{ n: string }>("select count(*) as n from machvon.audit_event where action = $1 and outcome = 'DENIED' and actor_id = $2", [
          `authz.denied:${operationId}`,
          member,
        ])
      ).rows[0]?.n,
    );

  async function send(request: MatrixRequest, caller: { tenantId: string; member: number; claims: Record<string, unknown> }): Promise<Reply> {
    const token = signTenantContext(contextFor(caller.tenantId, memberId(caller.member)), SIGNING_KEY);
    const headers: Record<string, string> = {
      [TENANT_HEADER]: token,
      [CLAIMS_HEADER]: JSON.stringify(caller.claims),
      'content-type': 'application/json',
      'idempotency-key': `key-${randomUUID()}`,
    };
    if (request.ifMatch !== undefined) headers['if-match'] = request.ifMatch;
    const response = await fetch(`${app.baseUrl}${request.path}`, { method: request.method, headers, body: JSON.stringify(request.body) });
    const text = await response.text();
    return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, text };
  }

  const aal2 = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ aal: 'aal2', aal2At: new Date().toISOString(), ...extra });

  async function observe(matrixCase: MatrixCase): Promise<Observation> {
    const fixture = COMMAND_FIXTURES[matrixCase.operationId];
    if (fixture === undefined) throw new Error(`no fixture for ${matrixCase.operationId}`);
    const request = fixture.build(targets);
    const caller =
      matrixCase.kind === 'wrong-tenant'
        ? { tenantId: TENANT_B, member: OTHER_TENANT_OWNER, claims: aal2() }
        : matrixCase.kind === 'control-plane'
          ? { tenantId: TENANT_A, member: roleMember('TENANT_OWNER'), claims: aal2({ aud: 'control' }) }
          : { tenantId: TENANT_A, member: roleMember(matrixCase.roleCode ?? ''), claims: aal2() };
    const actor = memberId(caller.member);
    const stateBefore = await fingerprint();
    const deniedBefore = await deniedRows(matrixCase.operationId, actor);
    const reply = await send(request, caller);
    return {
      status: reply.status,
      code: reply.json.code,
      text: reply.text,
      deniedRows: (await deniedRows(matrixCase.operationId, actor)) - deniedBefore,
      stateChanged: (await fingerprint()) !== stateBefore,
    };
  }

  const roleId = async (tenant: string, code: string): Promise<string> =>
    (await admin.query<{ id: string }>('select id from machvon.role_definition where tenant_id = $1 and code = $2', [tenant, code])).rows[0]?.id ?? '';

  const giveSystemRole = (tenant: string, member: number, grantN: number, roleUuid: string): Promise<unknown> =>
    harness.owner(tenant, [
      [
        `insert into machvon.role_grant (tenant_id, id, membership_id, role_id, scope_json, effective_from, scope_kind, scope_ref_ids, status, granted_by, grant_reason)
         values ($1, $2, $3, $4, '{"kind":"TENANT","ref_ids":[]}'::jsonb, '2026-01-01T00:00:00Z', 'TENANT', '{}', 'Active', $5, 'matrix')`,
        [tenant, grantId(grantN), memberId(member), roleUuid, ACTOR],
      ],
    ]);

  beforeAll(async () => {
    await harness.start();
    admin = new Client({ connectionString: harness.database.adminUrl });
    await admin.connect();
    // Tenant B has units with other ids, so the ids that the fixtures name exist in tenant A only.
    await harness.seedUnits(TENANT_A, [
      { n: 1, path: '/u1/' },
      { n: 2, path: '/u1/u2/', parent: 1 },
      { n: 3, path: '/u1/u3/', parent: 1 },
    ]);
    await harness.seedUnits(TENANT_B, [
      { n: 11, path: '/u11/' },
      { n: 12, path: '/u11/u12/', parent: 11 },
    ]);
    for (const tenant of [TENANT_A, TENANT_B]) {
      await harness.tenants.withTenant(contextFor(tenant, memberId(1)), (tx) => seedSystemRoles(tx, ACTOR));
    }
    await harness.seedMembership(TENANT_B, OTHER_TENANT_OWNER, 11);
    await harness.seedMembership(TENANT_A, RECIPIENT, 1);
    for (const [index, role] of SYSTEM_ROLES.entries()) {
      const member = ROLE_MEMBER_BASE + index;
      await harness.seedMembership(TENANT_A, member, 1);
      await giveSystemRole(TENANT_A, member, 100 + index, await roleId(TENANT_A, role.code));
    }
    // The wrong-tenant caller is a full TENANT_OWNER of tenant B: only the tenant boundary may stop it.
    await giveSystemRole(TENANT_B, OTHER_TENANT_OWNER, 100, await roleId(TENANT_B, 'TENANT_OWNER'));
    await harness.seedRole(TENANT_A, CUSTOM_ROLE, 'MATRIX_CUSTOM', ['iam.unit.manage'], 10);
    await harness.seedGrants(TENANT_A, [{ n: ONE_GRANT_TO_REVOKE, member: RECIPIENT, role: CUSTOM_ROLE, kind: 'TENANT' }]);
    const notificationId = id(0x70, 1);
    await harness.owner(TENANT_A, [
      [
        `insert into machvon.workflow_version (tenant_id, id, business_type, revision, definition_json, status, kind, event_type, created_by, definition_hash)
         values ($1, $2, 'NOTIFICATION', 1, '{}'::jsonb, 'Published', 'NOTIFICATION', 'matrix.notification', $3, repeat('a', 64))`,
        [TENANT_A, id(0x71, 1), ACTOR],
      ],
      [
        `insert into machvon.notification_instance (tenant_id, id, event_id, workflow_version_id, recipient_id, purpose, dedupe_key, expires_at, status, source_event_type, ack_required)
         values ($1, $2, $3, $4, $5, 'OPERATIONAL', $6, now() + interval '1 day', 'Delivered', 'matrix.notification', true)`,
        [TENANT_A, notificationId, id(0x72, 1), id(0x71, 1), memberId(RECIPIENT), `n1:${'a'.repeat(64)}`],
      ],
    ]);
    const legalHoldId = id(0x73, 1);
    await harness.owner(TENANT_A, [
      [
        `insert into machvon.legal_hold (tenant_id, id, resource_scope, authority_reference, reason, effective_at, hold_kind, status, placed_by, version)
         values ($1, $2, '{"kind":"TENANT","ids":[]}'::jsonb, 'MATRIX-FIXTURE-REF', 'negative matrix fixture hold', '2026-01-01T00:00:00Z', 'AUDIT', 'Active', $3, 1)`,
        [TENANT_A, legalHoldId, memberId(RECIPIENT)],
      ],
    ]);
    targets = {
      notificationId,
      legalHoldId,
      unit2: unitId(2),
      unit3: unitId(3),
      customRoleId: id(0x30, CUSTOM_ROLE),
      memberRoleId: await roleId(TENANT_A, 'MEMBER'),
      recipientMembershipId: memberId(RECIPIENT),
      grantToRevoke: grantId(ONE_GRANT_TO_REVOKE),
    };
    const database = new TenantDatabase(harness.appPool);
    app = await startTestApp({
      signingKey: SIGNING_KEY,
      imports: [
        AppModule.register({
          database,
          registry: loadErrorRegistry(ERROR_CODES_PATH),
          policy: { database, access: new EffectiveAccessStore(database, new InMemoryAuthzCache()) },
        }),
      ],
    });
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
    await admin?.end();
    await harness.stop();
  }, 60_000);

  const cases = negativeCasesFor(operationsOf(MATRIX_COMMANDS), SYSTEM_ROLES);

  it.each(MATRIX_COMMANDS)('%s: every generated case is refused and changes nothing', async (operationId) => {
    const mine = cases.filter((matrixCase) => matrixCase.operationId === operationId);
    expect(mine.length).toBeGreaterThan(2);
    const failures: string[] = [];
    for (const matrixCase of mine) {
      const observation = await observe(matrixCase);
      const problems = matrixCase.kind === 'wrong-tenant' ? evaluateWrongTenant(observation, TENANT_A_MARKERS, COMMAND_FIXTURES[operationId]?.referencesTenantIds ?? true) : evaluateGuardDenial(observation);
      for (const problem of problems) failures.push(`${matrixCase.id}: ${problem}`);
    }
    expect(failures).toEqual([]);
  }, 300_000);

  it('allows the same request for a role that holds the permission (the cases above are refused for the right reason)', async () => {
    const reply = await send(COMMAND_FIXTURES.createOrganizationUnit?.build(targets) as MatrixRequest, {
      tenantId: TENANT_A,
      member: roleMember('TENANT_ADMIN'),
      claims: aal2(),
    });
    expect(reply.status).toBe(201);
  });
});
