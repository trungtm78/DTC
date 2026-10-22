import { PERMISSIONS } from '@machvon/contracts';
import type { TenantDatabase } from '@machvon/db';
import { Client } from 'pg';
import { GRANT_FIXTURES, ROLE_FIXTURES, TENANT_IDS, UNIT_FIXTURES } from '../suite';
import type { IsolationChannel, TenantName } from '../suite';

const MEMBERSHIP_ID = '00000000-0000-4000-8000-0000000000f1';
const USER_ID = '00000000-0000-4000-8000-000000000061';
const ACTOR_ID = '00000000-0000-4000-8000-0000000000f0';

/** The operations whose permissions the TNT-A test role holds: every id-bearing operation the isolation suite aims at TNT-B. */
export const FULL_RIGHTS_OPERATIONS = [
  'get_resources_organization_unit',
  'get_resources_organization_unit_id',
  'createOrganizationUnit',
  'updateOrganizationUnit',
  'moveOrganizationUnit',
  'createCustomRole',
  'updateCustomRole',
  'grantRole',
  'revokeRoleGrant',
  'get_resources_role_grant',
  'get_resources_role_grant_id',
] as const;

const PERMISSION_OF = PERMISSIONS as Readonly<Record<string, string>>;
const FULL_RIGHTS = [...new Set(FULL_RIGHTS_OPERATIONS.map((operation) => PERMISSION_OF[operation] ?? ''))];

const INSERT_UNIT = `insert into machvon.organization_unit (tenant_id, id, code, name, valid_from)
  values ($1, $2, $3, $4, date '2026-01-01') on conflict do nothing`;

/** Inserts the fixture units of a tenant as machvon_owner (row-level security still applies, so the tenant is set). */
export async function seedTenantUnits(ownerUrl: string, tenant: TenantName): Promise<void> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [TENANT_IDS[tenant]]);
    for (const unit of UNIT_FIXTURES[tenant]) {
      await client.query(INSERT_UNIT, [TENANT_IDS[tenant], unit.id, unit.code, unit.name]);
    }
    await client.query('commit');
  } finally {
    await client.end();
  }
}

export function contextOf(tenant: TenantName): { tenantId: string; membershipId: string; scopeVersion: number } {
  return { tenantId: TENANT_IDS[tenant], membershipId: MEMBERSHIP_ID, scopeVersion: 1 };
}

interface Row {
  id: string;
  code: string;
  name: string;
}

function toResult(rows: Row[], emptyStatus: number): { status: number; body: string } {
  return { status: rows.length > 0 ? 200 : emptyStatus, body: JSON.stringify(rows) };
}

/** Reads organization units straight through TenantDatabase as machvon_app, so only row-level security isolates tenants. */
export function createDatabaseChannel(options: { ownerUrl: string; database: TenantDatabase }): IsolationChannel {
  return {
    name: 'database',
    seed: async (tenant) => {
      await seedTenantUnits(options.ownerUrl, tenant);
      await seedTenantAuthz(options.ownerUrl, tenant);
    },
    async readAs(user, target) {
      const targetId = UNIT_FIXTURES[target][0]?.id;
      const rows = await options.database.withTenant(contextOf(user), (tx) =>
        tx.query<Row>('select id, code, name from machvon.organization_unit where id = $1', [targetId]),
      );
      return toResult(rows, 404);
    },
    async listAs(user) {
      const rows = await options.database.withTenant(contextOf(user), (tx) =>
        tx.query<Row>('select id, code, name from machvon.organization_unit order by code'),
      );
      return { status: 200, body: JSON.stringify(rows) };
    },
    async foreignAttempts(user) {
      const role = await options.database.withTenant(contextOf(user), (tx) =>
        tx.query<Row>('select id, code, name from machvon.role_definition where id = $1', [ROLE_FIXTURES['TNT-B'].id]),
      );
      const grant = await options.database.withTenant(contextOf(user), (tx) =>
        tx.query<{ id: string }>('select id from machvon.role_grant where id = $1', [GRANT_FIXTURES['TNT-B'].id]),
      );
      return [
        { operation: 'database:role_definition', ...toResult(role, 404) },
        { operation: 'database:role_grant', ...toResult(grant as Row[], 404) },
      ];
    },
  };
}

const INSERT_USER = `insert into machvon.user_account (id, idp_subject, email_normalized, display_name, status)
  values ($1, 'isolation-subject', 'isolation@example.test', 'Isolation Tester', 'Active') on conflict do nothing`;
const INSERT_MEMBERSHIP = `insert into machvon.membership (tenant_id, id, user_id, organization_id, status)
  values ($1, $2, $3, $4, 'Active') on conflict do nothing`;
const INSERT_ROLE = `insert into machvon.role_definition (tenant_id, id, code, name, permissions, rank, status, created_by)
  values ($1, $2, $3, $4, $5, $6, 'Active', $7) on conflict do nothing`;
const INSERT_GRANT = `insert into machvon.role_grant
  (tenant_id, id, membership_id, role_id, scope_json, effective_from, scope_kind, scope_ref_ids, status, granted_by, grant_reason)
  values ($1, $2, $3, $4, '{"kind":"TENANT","ref_ids":[]}'::jsonb, '2026-01-01T00:00:00Z', 'TENANT', '{}', 'Active', $5, 'isolation fixture')
  on conflict do nothing`;

/**
 * Seeds what the policy guard needs: the test membership of a tenant with a TENANT-wide grant of a fixture role.
 * Both tenants' roles carry the permissions of every operation the suite uses (TNT-A rank 89, so a custom role), so the
 * only thing that can keep TNT-A away from TNT-B is the tenant boundary itself; TNT-B's role has a distinctive name that must never reach TNT-A. Units must be seeded first (the membership belongs to one).
 */
export async function seedTenantAuthz(ownerUrl: string, tenant: TenantName): Promise<void> {
  const tenantId = TENANT_IDS[tenant];
  const home = UNIT_FIXTURES[tenant][0]?.id;
  const role = ROLE_FIXTURES[tenant];
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(INSERT_USER, [USER_ID]);
    await client.query(INSERT_MEMBERSHIP, [tenantId, MEMBERSHIP_ID, USER_ID, home]);
    await client.query(INSERT_ROLE, [tenantId, role.id, role.code, role.name, FULL_RIGHTS, tenant === 'TNT-A' ? 89 : 40, ACTOR_ID]);
    await client.query(INSERT_GRANT, [tenantId, GRANT_FIXTURES[tenant].id, MEMBERSHIP_ID, role.id, ACTOR_ID]);
    await client.query('commit');
  } finally {
    await client.end();
  }
}

const SNAPSHOT_TABLES = ['organization_unit', 'role_definition', 'role_grant', 'membership'] as const;

/** Everything the suite seeded for a tenant as one string; reads as machvon_owner with the tenant set. */
export async function snapshotTenant(ownerUrl: string, tenant: TenantName): Promise<string> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [TENANT_IDS[tenant]]);
    const parts: unknown[] = [];
    for (const table of SNAPSHOT_TABLES) {
      const { rows } = await client.query<{ row: unknown }>(`select to_jsonb(t) as row from machvon.${table} t order by id`);
      parts.push(rows.map((row) => row.row));
    }
    await client.query('commit');
    return JSON.stringify(parts);
  } finally {
    await client.end();
  }
}
