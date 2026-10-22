import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { SCHEMA_SOURCE_PATH, generateMigrations } from '../src/generate-migrations';
import { MIGRATION_CHECKSUM_MISMATCH, MigrationChecksumError, migrate } from '../src/migrate';
import type { Migration } from '../src/migrate';
import { startTestDatabase } from '../src/test-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const migrations: Migration[] = generateMigrations(readFileSync(join(REPO_ROOT, SCHEMA_SOURCE_PATH), 'utf8'));
const DESIGN_TABLES = 291;

async function rows<T extends object>(url: string, text: string): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
}

async function count(url: string, text: string): Promise<number> {
  const [row] = await rows<{ n: string }>(url, text);
  return Number(row?.n);
}

// schema_migration is the migration ledger, not one of the design tables.
const TABLE_COUNT = `select count(*) as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'machvon' and c.relkind in ('r','p') and c.relname <> 'schema_migration'`;

describe('migrate on a fresh database', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) await database.stop();
  }, 60_000);

  it('applies V001 and V002 as machvon_owner and creates the 291 design tables', async () => {
    const result = await migrate(database.adminUrl, migrations, { profile: 'test' });
    expect(result).toEqual({ applied: ['V001__roles_and_grants', 'V002__schema'] });
    expect(await count(database.adminUrl, TABLE_COUNT)).toBe(DESIGN_TABLES);
  }, 120_000);

  it('records both versions with their SHA-256 checksums in machvon.schema_migration', async () => {
    const recorded = await rows<{ version: string; checksum: string }>(
      database.adminUrl,
      'select version, checksum from machvon.schema_migration order by version',
    );
    expect(recorded.map((r) => r.version)).toEqual(['V001__roles_and_grants', 'V002__schema']);
    for (const row of recorded) expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('owns every table by machvon_owner and lets machvon_app own nothing', async () => {
    expect(
      await count(
        database.adminUrl,
        `select count(*) as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
          where s.nspname = 'machvon' and c.relkind in ('r','p') and pg_get_userbyid(c.relowner) <> 'machvon_owner'`,
      ),
    ).toBe(0);
    const owned = await count(
      database.adminUrl,
      `select (select count(*) from pg_class where relowner = r.oid)
            + (select count(*) from pg_namespace where nspowner = r.oid)
            + (select count(*) from pg_proc where proowner = r.oid)
            + (select count(*) from pg_type where typowner = r.oid and typrelid = 0 and typelem = 0)
            + (select count(*) from pg_database where datdba = r.oid) as n
         from pg_roles r where r.rolname = 'machvon_app'`,
    );
    expect(owned).toBe(0);
  });

  it('gives machvon_app DML on tables but only INSERT and SELECT on audit_event', async () => {
    const [row] = await rows<Record<string, boolean>>(
      database.adminUrl,
      `select has_table_privilege('machvon_app','machvon.audit_event','SELECT') as a_select,
              has_table_privilege('machvon_app','machvon.audit_event','INSERT') as a_insert,
              has_table_privilege('machvon_app','machvon.audit_event','UPDATE') as a_update,
              has_table_privilege('machvon_app','machvon.audit_event','DELETE') as a_delete,
              has_table_privilege('machvon_app','machvon.audit_event','TRUNCATE') as a_truncate,
              has_table_privilege('machvon_app','machvon.tenant','SELECT') as t_select,
              has_table_privilege('machvon_app','machvon.tenant','INSERT') as t_insert,
              has_table_privilege('machvon_app','machvon.tenant','UPDATE') as t_update,
              has_table_privilege('machvon_app','machvon.tenant','DELETE') as t_delete,
              has_schema_privilege('machvon_app','machvon','USAGE') as s_usage,
              has_schema_privilege('machvon_app','machvon','CREATE') as s_create,
              has_table_privilege('machvon_app','machvon.schema_migration','SELECT') as m_select`,
    );
    expect(row).toEqual({
      a_select: true,
      a_insert: true,
      a_update: false,
      a_delete: false,
      a_truncate: false,
      t_select: true,
      t_insert: true,
      t_update: true,
      t_delete: true,
      s_usage: true,
      s_create: false,
      m_select: false,
    });
  });

  it('gives tables created by later migrations to machvon_owner with DML for machvon_app', async () => {
    const probe: Migration = { name: 'V900__probe', sql: 'CREATE TABLE machvon.probe (id integer);' };
    await migrate(database.adminUrl, [...migrations, probe], { profile: 'test' });
    const [row] = await rows<{ owner: string; app_insert: boolean }>(
      database.adminUrl,
      `select pg_get_userbyid(relowner) as owner, has_table_privilege('machvon_app', oid, 'INSERT') as app_insert
         from pg_class where oid = 'machvon.probe'::regclass`,
    );
    expect(row).toEqual({ owner: 'machvon_owner', app_insert: true });
  });

  it('returns { applied: [] } on a second run', async () => {
    expect(await migrate(database.adminUrl, migrations, { profile: 'test' })).toEqual({ applied: [] });
  });

  it('throws MIGRATION_CHECKSUM_MISMATCH when one byte of an applied migration changes', async () => {
    const edited = migrations.map((m) => (m.name === 'V002__schema' ? { ...m, sql: `${m.sql} ` } : m));
    const failure = await migrate(database.adminUrl, edited, { profile: 'test' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MigrationChecksumError);
    expect(failure).toMatchObject({ code: MIGRATION_CHECKSUM_MISMATCH });
    expect(MIGRATION_CHECKSUM_MISMATCH).toBe('MIGRATION_CHECKSUM_MISMATCH');
    expect((failure as Error).message).toContain('V002__schema');
  });

  it('does not apply a pending migration when an applied one has a checksum mismatch', async () => {
    const edited = migrations.map((m) => (m.name === 'V001__roles_and_grants' ? { ...m, sql: `${m.sql}\n` } : m));
    const pending: Migration = { name: 'V901__never', sql: 'CREATE TABLE machvon.never (id integer);' };
    await expect(migrate(database.adminUrl, [...edited, pending], { profile: 'test' })).rejects.toBeInstanceOf(MigrationChecksumError);
    expect(await count(database.adminUrl, "select count(*) as n from pg_class where relname = 'never'")).toBe(0);
  });

  it('rolls a failing migration back completely and does not record it', async () => {
    const broken: Migration = {
      name: 'V902__half',
      sql: 'CREATE TABLE machvon.half_applied (id integer);\nSELECT 1 / 0;',
    };
    await expect(migrate(database.adminUrl, [...migrations, broken], { profile: 'test' })).rejects.toThrow('division by zero');
    expect(await count(database.adminUrl, "select count(*) as n from pg_class where relname = 'half_applied'")).toBe(0);
    expect(await count(database.adminUrl, "select count(*) as n from machvon.schema_migration where version = 'V902__half'")).toBe(0);
  });

  it('applies the test profile to pgvector usage and fails loudly under the production profile', async () => {
    const vector: Migration = {
      name: 'V903__vector',
      sql: 'CREATE EXTENSION IF NOT EXISTS vector;\nCREATE TABLE machvon.vector_probe (id integer, embedding vector(1024));',
    };
    await expect(migrate(database.adminUrl, [...migrations, vector], { profile: 'production' })).rejects.toThrow(/vector/);
    expect(await count(database.adminUrl, "select count(*) as n from pg_class where relname = 'vector_probe'")).toBe(0);
    await migrate(database.adminUrl, [...migrations, vector], { profile: 'test' });
    const [column] = await rows<{ type: string }>(
      database.adminUrl,
      "select format_type(atttypid, atttypmod) as type from pg_attribute where attrelid = 'machvon.vector_probe'::regclass and attname = 'embedding'",
    );
    expect(column?.type).toBe('real[]');
  });

  it('fails loudly instead of half applying when the schema exists but no version is recorded', async () => {
    await rows(database.adminUrl, 'drop table machvon.schema_migration');
    await expect(migrate(database.adminUrl, migrations, { profile: 'test' })).rejects.toThrow(/already exists/);
    expect(await count(database.adminUrl, TABLE_COUNT)).toBeGreaterThanOrEqual(DESIGN_TABLES);
    const recorded = await rows<{ version: string }>(database.adminUrl, 'select version from machvon.schema_migration');
    expect(recorded.map((r) => r.version)).toEqual(['V001__roles_and_grants']);
  });
});

describe('migrate concurrency and defaults', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) await database.stop();
  }, 60_000);

  it('serialises two simultaneous runs so every migration is applied exactly once', async () => {
    const [first, second] = await Promise.all([
      migrate(database.adminUrl, migrations, { profile: 'test' }),
      migrate(database.adminUrl, migrations, { profile: 'test' }),
    ]);
    expect([...first.applied, ...second.applied].sort()).toEqual(['V001__roles_and_grants', 'V002__schema']);
    expect(await count(database.adminUrl, TABLE_COUNT)).toBe(DESIGN_TABLES);
  }, 120_000);

  it('defaults to the production profile', async () => {
    const vector: Migration = { name: 'V910__vector', sql: 'CREATE EXTENSION IF NOT EXISTS vector;' };
    await expect(migrate(database.adminUrl, [vector])).rejects.toThrow(/vector/);
  });

  it('releases the advisory lock after a failure so the next run can proceed', async () => {
    const broken: Migration = { name: 'V911__broken', sql: 'SELECT 1 / 0;' };
    await expect(migrate(database.adminUrl, [broken], { profile: 'test' })).rejects.toThrow('division by zero');
    await expect(migrate(database.adminUrl, migrations, { profile: 'test' })).resolves.toEqual({ applied: [] });
  });
});
