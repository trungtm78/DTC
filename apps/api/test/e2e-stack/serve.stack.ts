import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { EffectiveAccessStore, InMemoryAuthzCache, TenantDatabase, seedSystemRoles } from '@machvon/db';
import { startMigratedTestDatabase } from '@machvon/db/src/migrated-test-database';
import type { TestDatabase } from '@machvon/db/src/test-database';
import { DomainError, loadErrorRegistry, verifyTenantContext } from '@machvon/kernel';
import { Client, Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { PRINCIPAL_REQUEST_KEY } from '../../src/principal';
import { PUBLIC_METADATA_KEY, Public } from '../../src/public.decorator';
import { TENANT_REQUEST_KEY } from '../../src/tenant-context.decorator';
import { id as fixtureId } from '../../../../packages/db/test/support/authz-fixtures';
import { ERROR_CODES_PATH } from '../isolation/test-app';

/**
 * The API stack of the browser end-to-end tests (apps/web/e2e): one embedded PostgreSQL with every migration, the
 * real Nest application (policy guard, command pipeline, all controllers), two seeded tenants and the fixture users of
 * apps/web/e2e/support/e2e-fixtures.json. It is started as the `e2e:stack` script (a jest run that serves until it is
 * told to stop) and describes itself in the JSON file named by E2E_STACK_INFO once it is ready.
 *
 * Authentication is the development stand-in of the web: a bearer token signed with E2E_SESSION_KEY, whose payload
 * may carry the `aal` and `aal2At` claims (real sign-in arrives with ST-IAM-002).
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const FIXTURES_PATH = resolve(REPO_ROOT, 'apps', 'web', 'e2e', 'support', 'e2e-fixtures.json');
/** The temporary directory prefix of the stack's database: the orphan cleaner recognises its leftovers by it. */
export const STACK_TEMP_PREFIX = 'machvon-e2e-pg-';
const ACTOR = '00000000-0000-4000-8000-0000000000f0';

interface FixtureUser {
  key: string;
  displayName: string;
  membershipId: string;
}

interface Fixtures {
  tenants: { A: string; B: string };
  recipientMembershipId: string;
  users: FixtureUser[];
}

const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as Fixtures;
const userKey = (key: string): FixtureUser => {
  const user = fixtures.users.find((candidate) => candidate.key === key);
  if (user === undefined) throw new Error(`fixture user ${key} is missing`);
  return user;
};

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const unitId = (n: number): string => fixtureId(0x10, n);
const roleId = (n: number): string => fixtureId(0x30, n);
const grantId = (n: number): string => fixtureId(0x40, n);
const pathOf = (...chain: number[]): string => `/${chain.map(unitId).join('/')}/`;

interface UnitSeed {
  n: number;
  code: string;
  name: string;
  parent?: number;
  chain: number[];
}

const UNITS: Record<'A' | 'B', UnitSeed[]> = {
  A: [
    { n: 1, code: 'CB-HQ', name: 'Ủy ban nhân dân tỉnh Cao Bằng', chain: [1] },
    { n: 2, code: 'CB-SKHDT', name: 'Sở Kế hoạch và Đầu tư', parent: 1, chain: [1, 2] },
    { n: 3, code: 'CB-STC', name: 'Sở Tài chính', parent: 1, chain: [1, 3] },
    { n: 4, code: 'CB-SKHDT-VP', name: 'Văn phòng Sở Kế hoạch và Đầu tư', parent: 2, chain: [1, 2, 4] },
    { n: 5, code: 'CB-SKHDT-QLDA', name: 'Ban Quản lý dự án', parent: 2, chain: [1, 2, 5] },
  ],
  B: [
    { n: 1, code: 'LC-HQ', name: 'Ủy ban nhân dân tỉnh Lào Cai', chain: [1] },
    { n: 2, code: 'LC-SKHDT', name: 'Sở Kế hoạch và Đầu tư Lào Cai', parent: 1, chain: [1, 2] },
  ],
};

const READER_ROLE = { n: 90, code: 'E2E_READER', permissions: ['organization_unit.read', 'role_grant.read'], rank: 20 };

interface GrantPlan {
  n: number;
  user: string;
  role: string;
  kind: 'TENANT' | 'UNIT_SUBTREE';
  refs: string[];
}

const GRANTS: GrantPlan[] = [
  { n: 1, user: 'owner', role: 'TENANT_OWNER', kind: 'TENANT', refs: [] },
  { n: 2, user: 'unitAdmin', role: 'UNIT_ADMIN', kind: 'UNIT_SUBTREE', refs: [unitId(2)] },
  { n: 3, user: 'unitAdmin', role: READER_ROLE.code, kind: 'UNIT_SUBTREE', refs: [unitId(2)] },
  { n: 4, user: 'auditor', role: READER_ROLE.code, kind: 'TENANT', refs: [] },
  { n: 5, user: 'nobody', role: 'MEMBER', kind: 'TENANT', refs: [] },
];

/** Runs statements as machvon_owner with the tenant set (FORCE RLS applies to the owner too). */
async function asOwner<T extends object = Record<string, unknown>>(
  database: TestDatabase,
  tenantId: string,
  statements: Array<[string, unknown[]?]>,
): Promise<T[]> {
  const client = new Client({ connectionString: database.urlFor('machvon_owner') });
  await client.connect();
  try {
    await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    let last: T[] = [];
    for (const [text, params] of statements) last = (await client.query(text, params)).rows as T[];
    return last;
  } finally {
    await client.end();
  }
}

async function seedTenant(database: TestDatabase, tenants: TenantDatabase, name: 'A' | 'B'): Promise<void> {
  const tenantId = fixtures.tenants[name];
  await tenants.withTenant({ tenantId, membershipId: ACTOR, scopeVersion: 1 }, (tx) => seedSystemRoles(tx, ACTOR));
  const memberships = name === 'A' ? fixtures.users.map((user) => user.membershipId).concat(fixtures.recipientMembershipId) : [userKey('owner').membershipId];
  const statements: Array<[string, unknown[]?]> = [];
  for (const unit of UNITS[name]) {
    statements.push([
      `insert into machvon.organization_unit (tenant_id, id, code, name, parent_id, valid_from, path, depth)
       values ($1, $2, $3, $4, $5, date '2026-01-01', $6, $7)`,
      [tenantId, unitId(unit.n), unit.code, unit.name, unit.parent === undefined ? null : unitId(unit.parent), pathOf(...unit.chain), unit.chain.length - 1],
    ]);
  }
  for (const membershipId of memberships) {
    const organization = membershipId === userKey('unitAdmin').membershipId ? unitId(2) : unitId(1);
    statements.push([
      "insert into machvon.user_account (id, idp_subject, email_normalized, display_name, status) values ($1, $2, $3, $4, 'Active') on conflict do nothing",
      [membershipId, `e2e-${membershipId}`, `${membershipId}@example.test`, `E2E ${membershipId.slice(-2)}`],
    ]);
    statements.push([
      "insert into machvon.membership (tenant_id, id, user_id, organization_id, status, valid_from) values ($1, $2, $3, $4, 'Active', now() - interval '1 day')",
      [tenantId, membershipId, membershipId, organization],
    ]);
  }
  statements.push([
    "insert into machvon.role_definition (tenant_id, id, code, name, permissions, rank, status, created_by) values ($1, $2, $3, $3, $4, $5, 'Active', $6)",
    [tenantId, roleId(READER_ROLE.n), READER_ROLE.code, READER_ROLE.permissions, READER_ROLE.rank, ACTOR],
  ]);
  await asOwner(database, tenantId, statements);

  const roles = await asOwner<{ id: string; code: string }>(database, tenantId, [['select id, code from machvon.role_definition', []]]);
  const roleByCode = new Map(roles.map((row) => [row.code, row.id]));
  const plans: GrantPlan[] = name === 'A' ? GRANTS : GRANTS.filter((grant) => grant.user === 'owner');
  await asOwner(
    database,
    tenantId,
    plans.map((plan): [string, unknown[]] => [
      `insert into machvon.role_grant
         (tenant_id, id, membership_id, role_id, scope_json, effective_from, effective_until, scope_kind, scope_ref_ids, status, granted_by, grant_reason)
       values ($1, $2, $3, $4, $5::jsonb, '2026-01-01T00:00:00Z', null, $6, $7::uuid[], 'Active', $8, 'e2e fixture')`,
      [tenantId, grantId(plan.n), userKey(plan.user).membershipId, roleByCode.get(plan.role), JSON.stringify({ kind: plan.kind, ref_ids: plan.refs }), plan.kind, plan.refs, ACTOR],
    ]),
  );
}

const SIGNING_KEY = Symbol('E2E_SIGNING_KEY');

interface GuardedRequest {
  headers: Record<string, string | string[] | undefined>;
  [TENANT_REQUEST_KEY]?: unknown;
  [PRINCIPAL_REQUEST_KEY]?: unknown;
}

interface TokenClaims {
  aal?: string;
  aal2At?: string;
}

function claimsOf(token: string): TokenClaims {
  const payload = token.split('.')[0] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
}

/** Trusts a bearer token signed with the stack key (public routes need none) and states the assurance it carries. */
@Injectable()
class E2eAuthGuard implements CanActivate {
  constructor(
    @Inject(SIGNING_KEY) private readonly key: Buffer,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.get<boolean | undefined>(PUBLIC_METADATA_KEY, context.getHandler()) === true) return true;
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new DomainError('SESSION_EXPIRED', 401);
    const token = header.slice('Bearer '.length);
    const tenant = verifyTenantContext(token, this.key);
    const claims = claimsOf(token);
    request[TENANT_REQUEST_KEY] = tenant;
    request[PRINCIPAL_REQUEST_KEY] = {
      tenant,
      audience: 'tenant',
      assurance: claims.aal === 'aal2' ? 'aal2' : 'aal1',
      aal2At: claims.aal2At === undefined ? undefined : new Date(claims.aal2At),
      sessionId: `e2e-${tenant.membershipId}`,
    };
    return true;
  }
}

@Controller('__e2e')
class HealthController {
  @Get('health')
  @Public()
  health(): { ok: true } {
    return { ok: true };
  }
}

@Module({})
class E2eRootModule {}

export interface StackInfo {
  apiPort: number;
  /** A superuser connection for the tests' own assertions about rows. */
  adminUrl: string;
  tenants: Fixtures['tenants'];
  units: Record<'A' | 'B', Record<string, string>>;
}

function unitIds(name: 'A' | 'B'): Record<string, string> {
  return Object.fromEntries(UNITS[name].map((unit) => [unit.code, unitId(unit.n)]));
}

const pollUntil = async (done: () => boolean, intervalMs: number): Promise<void> => {
  while (!done()) await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
};

describe('e2e API stack', () => {
  it('serves the application on E2E_API_PORT until the stop file appears', async () => {
    const infoPath = required('E2E_STACK_INFO');
    const stopPath = `${infoPath}.stop`;
    const port = Number(required('E2E_API_PORT'));
    const key = Buffer.from(required('E2E_SESSION_KEY'), 'base64');
    mkdirSync(dirname(infoPath), { recursive: true });
    for (const stale of [infoPath, stopPath]) rmSync(stale, { force: true });
    writeFileSync(`${infoPath}.pid`, String(process.pid));

    const database = await startMigratedTestDatabase(REPO_ROOT, { tempPrefix: STACK_TEMP_PREFIX });
    const pool = new Pool({ connectionString: database.urlFor('machvon_app'), max: 8 });
    pool.on('error', () => undefined);
    let app: INestApplication | undefined;
    try {
      const tenants = new TenantDatabase(pool);
      await seedTenant(database, tenants, 'A');
      await seedTenant(database, tenants, 'B');
      const access = new EffectiveAccessStore(tenants, new InMemoryAuthzCache());
      const moduleRef = await Test.createTestingModule({
        imports: [
          {
            module: E2eRootModule,
            imports: [AppModule.register({ database: tenants, registry: loadErrorRegistry(ERROR_CODES_PATH), policy: { database: tenants, access } })],
            controllers: [HealthController],
            providers: [
              { provide: SIGNING_KEY, useValue: key },
              { provide: APP_GUARD, useClass: E2eAuthGuard },
            ],
          },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.listen(port, '127.0.0.1');
      const listening = (app.getHttpServer().address() as AddressInfo).port;
      const info: StackInfo = { apiPort: listening, adminUrl: database.adminUrl, tenants: fixtures.tenants, units: { A: unitIds('A'), B: unitIds('B') } };
      writeFileSync(infoPath, JSON.stringify(info, null, 2));
      await pollUntil(() => existsSync(stopPath), 500);
    } finally {
      rmSync(infoPath, { force: true });
      if (app) await app.close();
      await pool.end();
      await database.stop();
      rmSync(`${infoPath}.pid`, { force: true });
    }
  }, 24 * 60 * 60 * 1000);
});
