import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Client } from 'pg';
import { startTestDatabase } from '../src/test-database';
import type { TestDatabase } from '../src/test-database';

const ROLES = [
  'machvon_owner',
  'machvon_app',
  'machvon_control',
  'machvon_outbox_relay',
  'machvon_reporting',
  'machvon_sync',
] as const;

// A connection that can never be made must fail, not wait: another test server may have taken a freed port.
const CONNECT_TIMEOUT_MS = 10_000;

async function query<T extends object>(url: string, text: string): Promise<T[]> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  await client.connect();
  try {
    const result = await client.query<T>(text);
    return result.rows;
  } finally {
    await client.end();
  }
}

describe('startTestDatabase', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) {
      await database.stop();
    }
  }, 60_000);

  it('round-trips Vietnamese text exactly over the application role', async () => {
    const rows = await query<{ v: string }>(database.urlFor('machvon_app'), "select 'Đà Nẵng' as v");
    expect(rows).toEqual([{ v: 'Đà Nẵng' }]);
  });

  it('uses UTF8 encoding and the C locale', async () => {
    const rows = await query<{ enc: string; collate: string }>(
      database.adminUrl,
      "select pg_encoding_to_char(encoding) as enc, datcollate as collate from pg_database where datname = current_database()",
    );
    expect(rows).toEqual([{ enc: 'UTF8', collate: 'C' }]);
  });

  it('creates all six roles with login, no superuser and no RLS bypass', async () => {
    const rows = await query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
      database.adminUrl,
      "select rolname, rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname ~ '^machvon_' order by rolname",
    );
    expect(rows.map((r) => r.rolname)).toEqual([...ROLES].sort());
    for (const row of rows) {
      expect(row).toMatchObject({ rolcanlogin: true, rolsuper: false, rolbypassrls: false });
    }
  });

  it('reports rolbypassrls false for machvon_app', async () => {
    const rows = await query<{ rolbypassrls: boolean }>(
      database.adminUrl,
      "select rolbypassrls from pg_roles where rolname = 'machvon_app'",
    );
    expect(rows).toEqual([{ rolbypassrls: false }]);
  });

  it('connects as every role and reports the matching session user', async () => {
    for (const role of ROLES) {
      const rows = await query<{ u: string }>(database.urlFor(role), 'select current_user as u');
      expect(rows).toEqual([{ u: role }]);
    }
  });

  it('runs with a small memory footprint so many test servers fit side by side', async () => {
    const settings = await query<{ name: string; setting: string }>(
      database.adminUrl,
      "select name, setting from pg_settings where name in ('shared_buffers','max_connections','fsync','autovacuum','max_worker_processes') order by name",
    );
    expect(Object.fromEntries(settings.map((row) => [row.name, row.setting]))).toEqual({
      autovacuum: 'off',
      fsync: 'off',
      max_connections: '40',
      max_worker_processes: '4',
      shared_buffers: '2048', // 8 kB pages: 16 MB
    });
  });

  it('does not offer the vector extension in this build', async () => {
    const rows = await query<{ name: string }>(
      database.adminUrl,
      "select name from pg_available_extensions where name = 'vector'",
    );
    expect(rows).toEqual([]);
  });
});

describe('startTestDatabase lifecycle', () => {
  it('starts independent databases on distinct ports and refuses connections after stop', async () => {
    const first = await startTestDatabase();
    let second: TestDatabase | undefined;
    try {
      second = await startTestDatabase();
      expect(new URL(first.adminUrl).port).not.toBe(new URL(second.adminUrl).port);
      expect((await query<{ one: number }>(second.adminUrl, 'select 1 as one'))[0]?.one).toBe(1);
    } finally {
      if (second) {
        await second.stop();
      }
      await first.stop();
    }
    await expect(query(first.adminUrl, 'select 1')).rejects.toThrow();
  }, 180_000);

  it('stop is idempotent', async () => {
    const database = await startTestDatabase();
    await database.stop();
    await expect(database.stop()).resolves.toBeUndefined();
  }, 120_000);
});

describe('startTestDatabase options and failure handling', () => {
  const directoriesWithPrefix = (prefix: string): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith(prefix));
  const uniquePrefix = (): string => `machvon-pg-test-${randomUUID()}-`;

  it('creates its working directory with the injected prefix and removes it on stop', async () => {
    const prefix = uniquePrefix();
    const database = await startTestDatabase({ tempPrefix: prefix });
    try {
      expect(directoriesWithPrefix(prefix)).toHaveLength(1);
    } finally {
      await database.stop();
    }
    expect(directoriesWithPrefix(prefix)).toEqual([]);
  }, 120_000);

  it('stops the server and removes its directory when role creation fails', async () => {
    const prefix = uniquePrefix();
    const seenUrls: string[] = [];
    await expect(
      startTestDatabase({
        tempPrefix: prefix,
        provisionRoles: async (adminUrl) => {
          seenUrls.push(adminUrl);
          // The server really is up when provisioning runs.
          expect((await query<{ one: number }>(adminUrl, 'select 1 as one'))[0]?.one).toBe(1);
          expect(directoriesWithPrefix(prefix)).toHaveLength(1);
          throw new Error('role creation rejected by test');
        },
      }),
    ).rejects.toThrow('role creation rejected by test');
    expect(directoriesWithPrefix(prefix)).toEqual([]);
    expect(seenUrls).toHaveLength(1);
    await expect(query(seenUrls[0] ?? '', 'select 1')).rejects.toThrow();
  }, 120_000);

  it('uses the injected role provisioner instead of the default one', async () => {
    const prefix = uniquePrefix();
    const database = await startTestDatabase({ tempPrefix: prefix, provisionRoles: async () => undefined });
    try {
      const rows = await query<{ rolname: string }>(database.adminUrl, "select rolname from pg_roles where rolname ~ '^machvon_'");
      expect(rows).toEqual([]);
    } finally {
      await database.stop();
    }
  }, 120_000);
});
