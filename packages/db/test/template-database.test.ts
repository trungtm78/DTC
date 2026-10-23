import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { SHARED_DATABASE_ENV, createEmptyTestDatabase, createTestDatabase, sharedDatabaseInfo, startSharedDatabase } from '../src/template-database';
import type { SharedDatabase } from '../src/template-database';
import { startMigratedTestDatabase, usesSharedDatabase } from '../src/migrated-test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const PREFIX = 'machvon-pg-tpltest-';

async function rows<T extends object>(url: string, text: string, tenantId?: string): Promise<T[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (tenantId !== undefined) await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
}

describe('shared template database', () => {
  let shared: SharedDatabase;

  beforeAll(async () => {
    shared = await startSharedDatabase(REPO_ROOT, { tempPrefix: PREFIX });
  }, 300_000);

  afterAll(async () => {
    if (shared) await shared.stop();
  }, 60_000);

  it('describes the server in an info record that carries the root of the applied migrations', () => {
    expect(shared.info.root).toBe(REPO_ROOT);
    expect(shared.info.port).toBeGreaterThan(0);
    expect(Object.keys(shared.info.passwords).sort()).toEqual(
      ['machvon_app', 'machvon_control', 'machvon_outbox_relay', 'machvon_owner', 'machvon_reporting', 'machvon_sync'],
    );
  });

  // Measured on the Windows development machine: about two seconds for one copy of the 36 MB template, about eight
  // seconds for twenty at once; a loaded machine (the other suites running) needs up to about eleven. A server of its own
  // costs about fifteen seconds per suite, so the limit still proves the sharing pays.
  it('clones twenty databases in parallel within thirty seconds', async () => {
    const started = Date.now();
    const clones = await Promise.all(Array.from({ length: 20 }, () => createTestDatabase(shared.info)));
    const elapsed = Date.now() - started;
    try {
      expect(elapsed).toBeLessThan(30_000);
      const names = await Promise.all(clones.map(async (clone) => (await rows<{ db: string }>(clone.adminUrl, 'select current_database() as db'))[0]?.db));
      expect(new Set(names).size).toBe(20);
    } finally {
      await Promise.all(clones.map((clone) => clone.stop()));
    }
  }, 90_000);

  it('gives a clone the migrated schema, and a write in one clone is invisible in another', async () => {
    const first = await createTestDatabase(shared.info);
    const second = await createTestDatabase(shared.info);
    try {
      const tables = await rows<{ n: string }>(first.adminUrl, "select count(*) as n from pg_tables where schemaname = 'machvon'");
      expect(Number(tables[0]?.n)).toBeGreaterThan(280);
      await rows(
        first.urlFor('machvon_owner'),
        `insert into machvon.organization_unit (tenant_id, id, code, name, valid_from, path, depth)
         values ('${TENANT_A}', '00000000-0000-4000-a001-000000000001', 'CLONE', 'Only in the first clone', date '2026-01-01', '/x/', 1)`,
        TENANT_A,
      );
      const inFirst = await rows<{ n: string }>(first.urlFor('machvon_owner'), 'select count(*) as n from machvon.organization_unit', TENANT_A);
      const inSecond = await rows<{ n: string }>(second.urlFor('machvon_owner'), 'select count(*) as n from machvon.organization_unit', TENANT_A);
      expect([inFirst[0]?.n, inSecond[0]?.n]).toEqual(['1', '0']);
    } finally {
      await first.stop();
      await second.stop();
    }
  }, 60_000);

  it('keeps the roles, their passwords and row-level security working in a clone', async () => {
    const clone = await createTestDatabase(shared.info);
    try {
      await rows(
        clone.urlFor('machvon_owner'),
        `insert into machvon.organization_unit (tenant_id, id, code, name, valid_from, path, depth)
         values ('${TENANT_A}', '00000000-0000-4000-a001-000000000002', 'RLS', 'Tenant A unit', date '2026-01-01', '/y/', 1)`,
        TENANT_A,
      );
      const own = await rows<{ n: string }>(clone.urlFor('machvon_app'), 'select count(*) as n from machvon.organization_unit', TENANT_A);
      const foreign = await rows<{ n: string }>(clone.urlFor('machvon_app'), 'select count(*) as n from machvon.organization_unit', TENANT_B);
      expect([own[0]?.n, foreign[0]?.n]).toEqual(['1', '0']);
      const connect = await rows<{ ok: boolean }>(clone.adminUrl, "select has_database_privilege('machvon_app', current_database(), 'CONNECT') as ok");
      expect(connect[0]?.ok).toBe(true);
    } finally {
      await clone.stop();
    }
  }, 60_000);

  it('drops the clone on stop, and stop twice is harmless', async () => {
    const clone = await createTestDatabase(shared.info);
    const name = (await rows<{ db: string }>(clone.adminUrl, 'select current_database() as db'))[0]?.db ?? '';
    await clone.stop();
    await clone.stop();
    const left = await rows<{ n: string }>(shared.info.adminUrlOf('postgres'), `select count(*) as n from pg_database where datname = '${name}'`);
    expect(left[0]?.n).toBe('0');
  }, 60_000);

  it('does not let anyone connect to the template itself', async () => {
    await expect(rows(shared.info.adminUrlOf(shared.info.templateName), 'select 1')).rejects.toThrow();
  }, 30_000);

  it('creates an empty database with the roles but without the schema', async () => {
    const empty = await createEmptyTestDatabase(shared.info);
    try {
      const tables = await rows<{ n: string }>(empty.adminUrl, "select count(*) as n from pg_tables where schemaname = 'machvon'");
      expect(tables[0]?.n).toBe('0');
      const reachable = await rows<{ u: string }>(empty.urlFor('machvon_app'), 'select current_user as u');
      expect(reachable[0]?.u).toBe('machvon_app');
    } finally {
      await empty.stop();
    }
  }, 60_000);

  describe('the environment record', () => {
    const original = process.env[SHARED_DATABASE_ENV];

    afterEach(() => {
      if (original === undefined) delete process.env[SHARED_DATABASE_ENV];
      else process.env[SHARED_DATABASE_ENV] = original;
    });

    it('is read back by sharedDatabaseInfo and refused when it is not a valid record', () => {
      process.env[SHARED_DATABASE_ENV] = JSON.stringify(shared.info.record);
      expect(sharedDatabaseInfo()?.port).toBe(shared.info.port);
      process.env[SHARED_DATABASE_ENV] = '{"port":"nope"}';
      expect(() => sharedDatabaseInfo()).toThrow(/MACHVON_SHARED_DB/);
      process.env[SHARED_DATABASE_ENV] = 'off';
      expect(sharedDatabaseInfo()).toBeUndefined();
      delete process.env[SHARED_DATABASE_ENV];
      expect(sharedDatabaseInfo()).toBeUndefined();
    });

    it('lets startMigratedTestDatabase clone the template when the root matches and no private option is given', async () => {
      process.env[SHARED_DATABASE_ENV] = JSON.stringify(shared.info.record);
      const database = await startMigratedTestDatabase(REPO_ROOT);
      try {
        const name = (await rows<{ db: string }>(database.adminUrl, 'select current_database() as db'))[0]?.db ?? '';
        expect(name.startsWith('machvon_t_')).toBe(true);
        expect(new URL(database.adminUrl).port).toBe(String(shared.info.port));
      } finally {
        await database.stop();
      }
    }, 60_000);

    it('keeps a server of its own for a private option or another migration root', () => {
      expect(usesSharedDatabase(REPO_ROOT, {}, shared.info)).toBe(true);
      expect(usesSharedDatabase(REPO_ROOT, { tempPrefix: 'machvon-pg-own-' }, shared.info)).toBe(false);
      expect(usesSharedDatabase(REPO_ROOT, { maxConnections: 10 }, shared.info)).toBe(false);
      expect(usesSharedDatabase(REPO_ROOT, { provisionRoles: async () => undefined }, shared.info)).toBe(false);
      expect(usesSharedDatabase(resolve(REPO_ROOT, 'elsewhere'), {}, shared.info)).toBe(false);
      expect(usesSharedDatabase(REPO_ROOT, {}, undefined)).toBe(false);
      expect(usesSharedDatabase(REPO_ROOT, { tempPrefix: undefined }, shared.info)).toBe(true);
    });
  });
});

describe('stopping the shared server', () => {
  it('stops the server and removes its directory', async () => {
    const before = new Set((await import('node:fs')).readdirSync(tmpdir()).filter((entry) => entry.startsWith('machvon-pg-tplstop-')));
    const own = await startSharedDatabase(REPO_ROOT, { tempPrefix: 'machvon-pg-tplstop-' });
    const directory = (await import('node:fs')).readdirSync(tmpdir()).find((entry) => entry.startsWith('machvon-pg-tplstop-') && !before.has(entry));
    expect(directory).toBeDefined();
    await own.stop();
    expect(existsSync(join(tmpdir(), directory ?? ''))).toBe(false);
    await expect(rows(own.info.adminUrlOf('postgres'), 'select 1')).rejects.toThrow();
  }, 300_000);
});
