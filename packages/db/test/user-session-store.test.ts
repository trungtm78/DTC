import { resolve } from 'node:path';
import type { TenantContext } from '@machvon/kernel';
import { Client, Pool } from 'pg';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { TenantDatabase } from '../src/tenant-database';
import type { TestDatabase } from '../src/test-database';
import { UserSessionStore } from '../src/user-session-store';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const USER_1 = '00000000-0000-4000-8000-0000000000a1';
const UNIT_A = '00000000-0000-4000-8000-0000000000c1';
const UNIT_B = '00000000-0000-4000-8000-0000000000c2';
const MEMBERSHIP_A = '00000000-0000-4000-8000-0000000000d1';
const MEMBERSHIP_B = '00000000-0000-4000-8000-0000000000d2';
const IP_HASH = 'a'.repeat(64);

const ctxA: TenantContext = { tenantId: TENANT_A, membershipId: MEMBERSHIP_A, scopeVersion: 1 };
const ctxB: TenantContext = { tenantId: TENANT_B, membershipId: MEMBERSHIP_B, scopeVersion: 1 };

describe('UserSessionStore', () => {
  let database: TestDatabase;
  let pool: Pool;
  let store: UserSessionStore;
  let counter = 0;

  const open = (ctx: TenantContext, idpSessionId = `idp-${(counter += 1)}`, assurance: 'aal1' | 'aal2' = 'aal1') =>
    store.open(ctx, { userAccountId: USER_1, idpSessionId, assurance, ipHash: IP_HASH, userAgentSummary: 'Chrome 140 on Windows' });

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    pool = new Pool({ connectionString: database.urlFor('machvon_app'), max: 4 });
    pool.on('error', () => undefined);
    store = new UserSessionStore(new TenantDatabase(pool));
    const admin = new Client({ connectionString: database.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `insert into machvon.user_account (id, idp_subject, email_normalized, display_name, status) values ($1, 'sub-1', 'user.one@example.vn', 'User One', 'Active')`,
        [USER_1],
      );
      for (const [tenant, unit, membership] of [[TENANT_A, UNIT_A, MEMBERSHIP_A], [TENANT_B, UNIT_B, MEMBERSHIP_B]] as const) {
        await admin.query("select set_config('app.tenant_id', $1, false)", [tenant]);
        await admin.query(`insert into machvon.organization_unit (tenant_id, id, code, name, valid_from) values ($1, $2, 'ROOT', 'Root', date '2026-01-01')`, [tenant, unit]);
        await admin.query(`insert into machvon.membership (tenant_id, id, user_id, organization_id, status) values ($1, $2, $3, $4, 'Active')`, [tenant, membership, USER_1, unit]);
      }
    } finally {
      await admin.end();
    }
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (database) await database.stop();
  }, 60_000);

  it('opens a session bound to the tenant, the membership and the identity-provider session', async () => {
    const session = await open(ctxA, 'idp-open', 'aal2');
    expect(session).toMatchObject({ tenantId: TENANT_A, membershipId: MEMBERSHIP_A, userAccountId: USER_1, idpSessionId: 'idp-open', assurance: 'aal2' });
    expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await store.isRevoked(ctxA, session.id)).toBe(false);
  });

  it('revokes a session once, keeps the first reason and reports it revoked', async () => {
    const session = await open(ctxA);
    await store.revoke(ctxA, session.id, 'tenant switched');
    expect(await store.isRevoked(ctxA, session.id)).toBe(true);
    await store.revoke(ctxA, session.id, 'second reason');
    const admin = new Client({ connectionString: database.adminUrl });
    await admin.connect();
    try {
      const { rows } = await admin.query('select revoke_reason, revoked_at is not null as revoked from machvon.user_session where id = $1', [session.id]);
      expect(rows).toEqual([{ revoke_reason: 'tenant switched', revoked: true }]);
    } finally {
      await admin.end();
    }
  });

  it('treats an unknown session as revoked so a forged id is never accepted', async () => {
    expect(await store.isRevoked(ctxA, '00000000-0000-4000-8000-0000000000ff')).toBe(true);
  });

  it('refuses a second session for the same identity-provider session in a tenant', async () => {
    await open(ctxA, 'idp-same');
    await expect(open(ctxA, 'idp-same')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
  });

  it('allows the same identity-provider session id in another tenant', async () => {
    await open(ctxA, 'idp-shared');
    await expect(open(ctxB, 'idp-shared')).resolves.toMatchObject({ tenantId: TENANT_B });
  });

  it('keeps tenants apart: tenant B cannot see, revoke or probe a session of tenant A', async () => {
    const session = await open(ctxA);
    expect(await store.isRevoked(ctxB, session.id)).toBe(true);
    await store.revoke(ctxB, session.id, 'cross tenant attempt');
    expect(await store.isRevoked(ctxA, session.id)).toBe(false);
  });

  it('rejects an invalid tenant context before touching the database', async () => {
    await expect(store.isRevoked({ tenantId: 'nope', membershipId: MEMBERSHIP_A, scopeVersion: 1 }, USER_1)).rejects.toMatchObject({ code: 'TENANT_CONTEXT_INVALID' });
  });
});
