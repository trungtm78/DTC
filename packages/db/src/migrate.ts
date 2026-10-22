import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { PRIVILEGED_MARKER } from './generate-migrations.ts';
import { OWNER_ROLE } from './roles.ts';
import { applyTestProfile } from './test-profile.ts';

export interface Migration {
  name: string;
  sql: string;
}

export interface MigrateOptions {
  profile?: 'production' | 'test';
}

export const MIGRATION_CHECKSUM_MISMATCH = 'MIGRATION_CHECKSUM_MISMATCH';

export class MigrationChecksumError extends Error {
  readonly code = MIGRATION_CHECKSUM_MISMATCH;
  readonly migration: string;

  constructor(migration: string) {
    super(`${MIGRATION_CHECKSUM_MISMATCH}: applied migration ${migration} was edited after it ran`);
    this.name = 'MigrationChecksumError';
    this.migration = migration;
  }
}

// Arbitrary constant: the same key on every node serialises concurrent migration runs.
const ADVISORY_LOCK_KEY = 7_245_391_001;

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

async function readApplied(client: Client): Promise<Map<string, string>> {
  const exists = await client.query<{ present: boolean }>("select to_regclass('machvon.schema_migration') is not null as present");
  if (exists.rows[0]?.present !== true) return new Map();
  const { rows } = await client.query<{ version: string; checksum: string }>('select version, checksum from machvon.schema_migration');
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

// The ledger belongs to the owner role, which is the only role that may change it; the application
// role gets no default privileges on it because it is created by the privileged connection.
async function ensureLedger(client: Client): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS machvon');
  const { rows } = await client.query<{ created: boolean }>(
    "select to_regclass('machvon.schema_migration') is null as created",
  );
  if (rows[0]?.created !== true) return;
  await client.query(
    `CREATE TABLE machvon.schema_migration (
       version text PRIMARY KEY,
       checksum text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await client.query(`ALTER TABLE machvon.schema_migration OWNER TO ${OWNER_ROLE}`);
}

async function applyOne(client: Client, migration: Migration, profile: 'production' | 'test'): Promise<void> {
  const text = profile === 'test' ? applyTestProfile(migration.sql) : migration.sql;
  await client.query('BEGIN');
  try {
    if (!migration.sql.includes(PRIVILEGED_MARKER)) await client.query(`SET LOCAL ROLE ${OWNER_ROLE}`);
    await client.query(text);
    await client.query('RESET ROLE');
    await ensureLedger(client);
    await client.query('INSERT INTO machvon.schema_migration (version, checksum) VALUES ($1, $2)', [
      migration.name,
      checksumOf(migration.sql),
    ]);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Migration ${migration.name} failed and could not be rolled back`);
    }
    throw error;
  }
}

/**
 * Applies pending migrations in order, each in its own transaction, under an advisory lock.
 * Migrations run as machvon_owner unless they carry the privileged marker (roles and grants).
 * `adminUrl` must connect as a role that may SET ROLE to machvon_owner and create roles (superuser).
 * Applied migrations are verified by SHA-256 before anything new runs.
 */
export async function migrate(
  adminUrl: string,
  migrations: Migration[],
  opts: MigrateOptions = {},
): Promise<{ applied: string[] }> {
  const profile = opts.profile ?? 'production';
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    try {
      const recorded = await readApplied(client);
      for (const migration of migrations) {
        const checksum = recorded.get(migration.name);
        if (checksum !== undefined && checksum !== checksumOf(migration.sql)) throw new MigrationChecksumError(migration.name);
      }
      const applied: string[] = [];
      for (const migration of migrations) {
        if (recorded.has(migration.name)) continue;
        await applyOne(client, migration, profile);
        applied.push(migration.name);
      }
      return { applied };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
