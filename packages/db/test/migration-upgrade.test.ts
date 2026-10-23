import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadCommittedMigrations } from '../src/generate-migrations';
import { migrate } from '../src/migrate';
import type { Migration } from '../src/migrate';
import { startTestDatabase } from '../src/test-database';
import type { MachvonRole, TestDatabase } from '../src/test-database';

// ST-KERNEL-020 AC-3 (OPS02): a database that holds data under the previous migrations is upgraded one
// migration at a time, with zero data loss, and the guards the newer migrations add start to hold.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = '00000000-0000-4000-8000-00000000000b';
const USER = '00000000-0000-4000-8000-0000000000f1';
const UNIT = '00000000-0000-4000-8000-0000000000a1';
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000b1';
const ROLE = '00000000-0000-4000-8000-0000000000c1';
const SYSTEM_ROLE = '00000000-0000-4000-8000-0000000000c2';
const GRANT = '00000000-0000-4000-8000-0000000000d1';
const AUDIT = '00000000-0000-4000-8000-0000000000e1';
const OUTBOX = '00000000-0000-4000-8000-0000000000e2';
const IDEMPOTENCY = '00000000-0000-4000-8000-0000000000e3';
/** The migrations that exist before any upgrade is exercised: the generated V001 and V002. */
const BASELINE_MIGRATIONS = 2;

// Every table the sample rows live in, with the columns that must survive an upgrade unchanged.
const FINGERPRINTS: Record<string, string> = {
  organization_unit: 'select id, code, name, parent_id, valid_from::text from machvon.organization_unit order by id',
  membership: 'select id, user_id, organization_id, status from machvon.membership order by id',
  role_definition: 'select id, code, permissions, rank, is_system, status from machvon.role_definition order by id',
  role_grant: 'select id, membership_id, role_id, scope_kind, scope_ref_ids, status from machvon.role_grant order by id',
  audit_event: 'select id, actor_id, action, resource_type, resource_id, safe_diff, correlation_id, request_id, outcome from machvon.audit_event order by id',
  outbox_event: 'select id, aggregate_id, type, payload, event_key, status from machvon.outbox_event order by id',
  idempotency_record: 'select id, subject_id, operation, key_hash, request_hash, status from machvon.idempotency_record order by id',
};

async function owner(database: TestDatabase, tenantId: string = TENANT): Promise<Client> {
  const client = new Client({ connectionString: database.urlFor('machvon_owner') });
  await client.connect();
  await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
  return client;
}

async function failureCode(client: Client, text: string): Promise<string | undefined> {
  try {
    await client.query(text);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function seed(database: TestDatabase): Promise<void> {
  const client = await owner(database);
  try {
    await client.query(
      `insert into machvon.organization_unit (tenant_id, id, code, name, valid_from) values ('${TENANT}', '${UNIT}', 'ROOT', 'Đà Nẵng', date '2026-01-01')`,
    );
    await client.query(
      `insert into machvon.user_account (id, idp_subject, email_normalized, display_name, status) values ('${USER}', 'sub-1', 'a@example.test', 'A', 'Active')`,
    );
    await client.query(
      `insert into machvon.membership (tenant_id, id, user_id, organization_id, status) values ('${TENANT}', '${MEMBERSHIP}', '${USER}', '${UNIT}', 'Active')`,
    );
    await client.query(
      `insert into machvon.role_definition (tenant_id, id, code, name, permissions, rank, is_system, status, created_by) values
         ('${TENANT}', '${ROLE}', 'CUSTOM', 'Custom', '{iam.unit.manage}', 50, false, 'Active', '${USER}'),
         ('${TENANT}', '${SYSTEM_ROLE}', 'SYSTEM_ADMIN', 'System admin', '{iam.*,adm.*}', 99, true, 'Active', '${USER}')`,
    );
    await client.query(
      `insert into machvon.role_grant (tenant_id, id, membership_id, role_id, scope_json, effective_from, granted_by, grant_reason, scope_kind, scope_ref_ids)
         values ('${TENANT}', '${GRANT}', '${MEMBERSHIP}', '${ROLE}', '{}', now(), '${USER}', 'seed', 'UNIT_ONLY', array['${UNIT}']::uuid[])`,
    );
    await client.query(
      `insert into machvon.audit_event (tenant_id, id, actor_id, action, resource_type, resource_id, safe_diff, correlation_id, request_id, occurred_at)
         values ('${TENANT}', '${AUDIT}', '${USER}', 'seed.created', 'organization_unit', '${UNIT}', '{"name":"Đà Nẵng"}', '${AUDIT}', '${AUDIT}', now())`,
    );
    await client.query(
      `insert into machvon.outbox_event (tenant_id, id, aggregate_id, type, schema_version, payload, created_at, aggregate_type, aggregate_version, event_key, correlation_id)
         values ('${TENANT}', '${OUTBOX}', '${UNIT}', 'OrganizationUnitCreated', 1, '{"unit":"ROOT"}', now(), 'organization_unit', 1, 'unit:ROOT', '${OUTBOX}')`,
    );
    await client.query(
      `insert into machvon.idempotency_record (tenant_id, id, subject_id, operation, key_hash, request_hash, response_ref, status, expires_at)
         values ('${TENANT}', '${IDEMPOTENCY}', '${USER}', 'createUnit', repeat('a', 64), repeat('b', 64), '{}', 'COMPLETED', now() + interval '72 hours')`,
    );
  } finally {
    await client.end();
  }
}

async function fingerprint(database: TestDatabase): Promise<Record<string, unknown[]>> {
  const client = await owner(database);
  try {
    const result: Record<string, unknown[]> = {};
    for (const [table, sql] of Object.entries(FINGERPRINTS)) result[table] = (await client.query(sql)).rows;
    return result;
  } finally {
    await client.end();
  }
}

describe('upgrading a database that already holds data, one migration at a time', () => {
  let database: TestDatabase;
  let migrations: Migration[];
  let before: Record<string, unknown[]>;
  const urlFor = (role: MachvonRole): string => database.urlFor(role);

  beforeAll(async () => {
    migrations = await loadCommittedMigrations(REPO_ROOT);
    database = await startTestDatabase();
    await migrate(database.adminUrl, migrations.slice(0, BASELINE_MIGRATIONS), { profile: 'test' });
    await seed(database);
    before = await fingerprint(database);
  }, 240_000);

  afterAll(async () => {
    if (database) await database.stop();
  }, 60_000);

  it('starts from a populated database that only has the generated baseline', async () => {
    expect(migrations.length).toBeGreaterThan(BASELINE_MIGRATIONS);
    for (const [table, rows] of Object.entries(before)) expect([table, rows.length > 0]).toEqual([table, true]);
    expect(before.role_definition).toHaveLength(2);
    const client = await owner(database);
    try {
      const { rows } = await client.query("select to_regclass('machvon.membership') is not null as membership, (select count(*) from information_schema.columns where table_schema = 'machvon' and table_name = 'membership' and column_name = 'scope_version') as scope_version");
      expect(rows[0]).toEqual({ membership: true, scope_version: '0' });
    } finally {
      await client.end();
    }
  });

  it('applies each later migration alone and loses no row and no value on the way', async () => {
    const applied: string[] = [];
    for (let upTo = BASELINE_MIGRATIONS + 1; upTo <= migrations.length; upTo += 1) {
      const result = await migrate(database.adminUrl, migrations.slice(0, upTo), { profile: 'test' });
      const name = migrations[upTo - 1]?.name;
      expect(result.applied).toEqual([name]);
      applied.push(name ?? '');
      expect(await fingerprint(database)).toEqual(before);
    }
    expect(applied).toEqual(migrations.slice(BASELINE_MIGRATIONS).map((migration) => migration.name));
    expect(await migrate(database.adminUrl, migrations, { profile: 'test' })).toEqual({ applied: [] });
  }, 240_000);

  it('gives the existing membership its default scope version', async () => {
    const client = await owner(database);
    try {
      const { rows } = await client.query<{ scope_version: string }>(`select scope_version::text from machvon.membership where id = '${MEMBERSHIP}'`);
      expect(rows).toEqual([{ scope_version: '1' }]);
    } finally {
      await client.end();
    }
  });

  it('makes the audit tables append-only for the rows that were written before the upgrade', async () => {
    const ownerClient = await owner(database);
    const appRole = new Client({ connectionString: urlFor('machvon_app') });
    await appRole.connect();
    await appRole.query("select set_config('app.tenant_id', $1, false)", [TENANT]);
    try {
      expect(await failureCode(appRole, `update machvon.audit_event set action = 'x' where id = '${AUDIT}'`)).toBe('42501');
      expect(await failureCode(appRole, `delete from machvon.role_grant where id = '${GRANT}'`)).toBe('42501');
      expect(await failureCode(ownerClient, `update machvon.audit_event set action = 'seed.created' where id = '${AUDIT}'`)).toBeUndefined();
    } finally {
      await appRole.end();
      await ownerClient.end();
    }
  });

  it('enforces the newer constraints on old and new rows alike', async () => {
    const client = await owner(database);
    try {
      expect(await failureCode(client, `update machvon.role_definition set permissions = '{system.*}' where id = '${ROLE}'`)).toBe('23514');
      expect(await failureCode(client, `update machvon.role_definition set rank = 95 where id = '${ROLE}'`)).toBe('23514');
      expect(
        await failureCode(
          client,
          `insert into machvon.role_grant (tenant_id, id, membership_id, role_id, scope_json, effective_from, granted_by, grant_reason, scope_kind, scope_ref_ids)
             values ('${TENANT}', '00000000-0000-4000-8000-0000000000d2', '${MEMBERSHIP}', '${ROLE}', '{}', now(), '${USER}', 'again', 'UNIT_ONLY', array['${UNIT}']::uuid[])`,
        ),
      ).toBe('23505');
    } finally {
      await client.end();
    }
  });

  it('keeps the tenant boundary: the other tenant sees none of the migrated rows', async () => {
    const client = await owner(database, OTHER_TENANT);
    try {
      for (const table of Object.keys(FINGERPRINTS)) {
        const { rows } = await client.query<{ n: string }>(`select count(*) as n from machvon.${table}`);
        expect(rows[0]?.n).toBe('0');
      }
    } finally {
      await client.end();
    }
  });
});

