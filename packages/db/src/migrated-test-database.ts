import { loadCommittedMigrations } from './generate-migrations.ts';
import { migrate } from './migrate.ts';
import { startTestDatabase } from './test-database.ts';
import type { TestDatabase, TestDatabaseOptions } from './test-database.ts';

/**
 * Starts embedded PostgreSQL and applies every committed migration (generated V001/V002 and the
 * hand-written ones after them) with the TEST profile. The server is stopped when a migration fails. `options` are
 * those of startTestDatabase (a private temporary directory prefix, for one).
 */
export async function startMigratedTestDatabase(root: string, options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const database = await startTestDatabase(options);
  try {
    await migrate(database.adminUrl, await loadCommittedMigrations(root), { profile: 'test' });
    return database;
  } catch (error) {
    await database.stop();
    throw error;
  }
}
