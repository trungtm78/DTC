import { readdirSync } from 'node:fs';
import type { Pool } from 'pg';
import type { ReadinessProbe } from './health.controller';

/** The migration names the code ships: the `.sql` files of the directory, without the extension (the names of the ledger). */
export function expectedMigrations(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.slice(0, -'.sql'.length))
    .sort();
}

/**
 * Readiness over the control-plane pool: one trivial query, and the ledger `machvon.schema_migration` (readable by that
 * role through the control schema grants) compared with the migrations the code expects.
 */
export class DatabaseReadinessProbe implements ReadinessProbe {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly expected: () => readonly string[],
  ) {}

  async database(): Promise<void> {
    await this.pool.query('select 1');
  }

  async pendingMigrations(): Promise<readonly string[]> {
    const { rows } = await this.pool.query<{ version: string }>('select version from machvon.schema_migration');
    const applied = new Set(rows.map((row) => row.version));
    return this.expected().filter((name) => !applied.has(name));
  }
}
