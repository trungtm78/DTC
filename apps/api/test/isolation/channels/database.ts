import type { TenantDatabase } from '@machvon/db';
import { Client } from 'pg';
import { TENANT_IDS, UNIT_FIXTURES } from '../suite';
import type { IsolationChannel, TenantName } from '../suite';

const MEMBERSHIP_ID = '00000000-0000-4000-8000-0000000000f1';

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
    seed: (tenant) => seedTenantUnits(options.ownerUrl, tenant),
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
  };
}
