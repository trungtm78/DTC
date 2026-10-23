import { resolve } from 'node:path';
import { loadCommittedMigrations } from './generate-migrations.ts';
import { migrate } from './migrate.ts';
import { createTestDatabase, sharedDatabaseInfo } from './template-database.ts';
import type { SharedDatabaseInfo } from './template-database.ts';
import { startTestDatabase } from './test-database.ts';
import type { TestDatabase, TestDatabaseOptions } from './test-database.ts';

/**
 * Whether a migrated database may be a copy of the shared template: a shared server exists, it holds the migrations of
 * this same root, and no private option (a temporary prefix, a role provisioner, a connection limit) asks for a server
 * of its own.
 */
export function usesSharedDatabase(root: string, options: TestDatabaseOptions, shared: SharedDatabaseInfo | undefined): shared is SharedDatabaseInfo {
  return shared !== undefined && Object.values(options).every((value) => value === undefined) && resolve(root) === resolve(shared.root);
}

/**
 * A database with every committed migration applied (generated V001/V002 and the hand-written ones after them), TEST
 * profile. During a test run with a shared server (jest global setup) and no private option, it is a cheap copy of the
 * migrated template; otherwise it is a server of its own, which is stopped when a migration fails. `options` are those
 * of startTestDatabase (a private temporary directory prefix, for one): a suite that gives one needs its own server.
 */
export async function startMigratedTestDatabase(root: string, options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const shared = sharedDatabaseInfo();
  if (usesSharedDatabase(root, options, shared)) return createTestDatabase(shared);
  const database = await startTestDatabase(options);
  try {
    await migrate(database.adminUrl, await loadCommittedMigrations(root), { profile: 'test' });
    return database;
  } catch (error) {
    await database.stop();
    throw error;
  }
}
