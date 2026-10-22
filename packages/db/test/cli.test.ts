import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Client } from 'pg';
import { main } from '../src/cli';
import { MIGRATIONS_DIR, SCHEMA_SOURCE_PATH } from '../src/generate-migrations';
import { startTestDatabase } from '../src/test-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const realSchema = readFileSync(join(REPO_ROOT, SCHEMA_SOURCE_PATH), 'utf8');

function scratchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'machvon-cli-'));
  const source = join(root, SCHEMA_SOURCE_PATH);
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, realSchema);
  return root;
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

describe('cli generate and check', () => {
  it('fails check before generation, generates, then passes check', async () => {
    const root = scratchRoot();
    const io = capture();
    expect(await main(['check', '--root', root], {}, io)).toBe(1);
    expect(io.lines.join('\n')).toContain('V001__roles_and_grants.sql');
    expect(await main(['generate', '--root', root], {}, io)).toBe(0);
    expect(readFileSync(join(root, MIGRATIONS_DIR, 'V002__schema.sql'), 'utf8')).toContain('CREATE TABLE tenant');
    expect(await main(['check', '--root', root], {}, io)).toBe(0);
  });

  it('prints usage and exits 2 for a missing or unknown command', async () => {
    const io = capture();
    expect(await main([], {}, io)).toBe(2);
    expect(await main(['bogus'], {}, io)).toBe(2);
    expect(io.lines.join('\n')).toContain('Usage');
  });

  it('exits 2 when migrate has no DATABASE_URL', async () => {
    const io = capture();
    expect(await main(['migrate', '--root', REPO_ROOT], {}, io)).toBe(2);
    expect(io.lines.join('\n')).toContain('DATABASE_URL');
  });

  it('rejects an unknown profile', async () => {
    const io = capture();
    expect(await main(['migrate', '--root', REPO_ROOT], { DATABASE_URL: 'postgres://x', MACHVON_DB_PROFILE: 'staging' }, io)).toBe(2);
    expect(io.lines.join('\n')).toContain('MACHVON_DB_PROFILE');
  });
});

describe('cli migrate', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) await database.stop();
  }, 60_000);

  it('applies the committed migrations, then reports nothing to apply', async () => {
    const env = { DATABASE_URL: database.adminUrl, MACHVON_DB_PROFILE: 'test' };
    const first = capture();
    expect(await main(['migrate', '--root', REPO_ROOT], env, first)).toBe(0);
    expect(first.lines).toEqual(['Applied: V001__roles_and_grants, V002__schema, V003__platform_services, V004__authorization_core']);
    const client = new Client({ connectionString: database.adminUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ n: string }>('select count(*) as n from machvon.schema_migration');
      expect(rows[0]?.n).toBe('4');
    } finally {
      await client.end();
    }
    const second = capture();
    expect(await main(['migrate', '--root', REPO_ROOT], env, second)).toBe(0);
    expect(second.lines).toEqual(['Nothing to apply']);
  }, 120_000);

  it('refuses to migrate when committed files are stale', async () => {
    const root = scratchRoot();
    const io = capture();
    expect(await main(['migrate', '--root', root], { DATABASE_URL: database.adminUrl, MACHVON_DB_PROFILE: 'test' }, io)).toBe(1);
    expect(io.lines.join('\n')).toContain('out of date');
  });
});
