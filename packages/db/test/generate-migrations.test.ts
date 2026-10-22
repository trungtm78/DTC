import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  MIGRATIONS_DIR,
  SCHEMA_SOURCE_PATH,
  checkGenerated,
  generateMigrations,
  writeGenerated,
} from '../src/generate-migrations';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const realSchema = readFileSync(join(REPO_ROOT, SCHEMA_SOURCE_PATH), 'utf8');

function scratchRoot(schema: string): string {
  const root = mkdtempSync(join(tmpdir(), 'machvon-gen-'));
  const source = join(root, SCHEMA_SOURCE_PATH);
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, schema);
  return root;
}

describe('generateMigrations', () => {
  it('returns exactly V001 then V002 for the real schema', () => {
    const migrations = generateMigrations(realSchema);
    expect(migrations.map((m) => m.name)).toEqual(['V001__roles_and_grants', 'V002__schema']);
  });

  it('is deterministic: two runs give identical bytes', () => {
    expect(generateMigrations(realSchema)).toEqual(generateMigrations(realSchema));
  });

  it('is independent of the line endings of the source', () => {
    expect(generateMigrations(realSchema.replace(/\n/g, '\r\n'))).toEqual(generateMigrations(realSchema));
  });

  it('puts the SHA-256 of the source in the header of both migrations', () => {
    const digest = createHash('sha256').update(realSchema).digest('hex');
    for (const migration of generateMigrations(realSchema)) {
      expect(migration.sql.split('\n')[0]).toContain(digest);
    }
  });

  it('changes the header when the source changes', () => {
    const [first] = generateMigrations(realSchema);
    const [second] = generateMigrations(`${realSchema}\n-- edited`);
    expect(first?.sql).not.toBe(second?.sql);
  });

  it('embeds the design schema verbatim in V002', () => {
    const v002 = generateMigrations(realSchema)[1];
    expect(v002?.sql).toContain(realSchema);
  });

  it('creates the six roles, grants usage and default privileges, and marks V001 privileged', () => {
    const v001 = generateMigrations(realSchema)[0]?.sql ?? '';
    for (const role of ['machvon_owner', 'machvon_app', 'machvon_control', 'machvon_outbox_relay', 'machvon_reporting', 'machvon_sync']) {
      expect(v001).toContain(`'${role}'`);
    }
    expect(v001).toContain('-- migrate: privileged');
    expect(v001).toContain('GRANT USAGE ON SCHEMA machvon');
    expect(v001).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE machvon_owner IN SCHEMA machvon');
    expect(v001).not.toMatch(/PASSWORD\s+'/i);
  });

  it('revokes UPDATE and DELETE on the real audit table after the schema creates it', () => {
    const [v001, v002] = generateMigrations(realSchema);
    expect(realSchema).toMatch(/CREATE TABLE audit_event \(/);
    expect(v001?.sql).not.toContain('audit_entry');
    expect(v002?.sql).toContain('REVOKE UPDATE, DELETE ON machvon.audit_event FROM machvon_app;');
    expect(v002?.sql.indexOf('REVOKE UPDATE, DELETE ON machvon.audit_event')).toBeGreaterThan(v002?.sql.indexOf(realSchema) ?? 0);
  });

  it('does not run V002 as a privileged migration', () => {
    expect(generateMigrations(realSchema)[1]?.sql).not.toContain('-- migrate: privileged');
  });
});

describe('checkGenerated', () => {
  it('passes for the committed migrations of this repository', async () => {
    await expect(checkGenerated(REPO_ROOT)).resolves.toBeUndefined();
  });

  it('passes after writeGenerated and writes LF files named after the migrations', async () => {
    const root = scratchRoot(realSchema);
    const written = await writeGenerated(root);
    expect(written).toEqual(['V001__roles_and_grants.sql', 'V002__schema.sql']);
    await expect(checkGenerated(root)).resolves.toBeUndefined();
    expect(readFileSync(join(root, MIGRATIONS_DIR, 'V002__schema.sql'), 'utf8')).not.toContain('\r');
  });

  it('accepts committed files with CRLF line endings', async () => {
    const root = scratchRoot(realSchema);
    await writeGenerated(root);
    const path = join(root, MIGRATIONS_DIR, 'V001__roles_and_grants.sql');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
    await expect(checkGenerated(root)).resolves.toBeUndefined();
  });

  it('throws naming the file when a committed migration differs by one byte', async () => {
    const root = scratchRoot(realSchema);
    await writeGenerated(root);
    const path = join(root, MIGRATIONS_DIR, 'V002__schema.sql');
    writeFileSync(path, `${readFileSync(path, 'utf8')} `);
    await expect(checkGenerated(root)).rejects.toThrow('V002__schema.sql');
  });

  it('throws when a committed migration is missing', async () => {
    const root = scratchRoot(realSchema);
    await expect(checkGenerated(root)).rejects.toThrow('V001__roles_and_grants.sql');
  });

  it('throws when the design schema changed after generation', async () => {
    const root = scratchRoot(realSchema);
    await writeGenerated(root);
    writeFileSync(join(root, SCHEMA_SOURCE_PATH), `${realSchema}\n-- edited`);
    await expect(checkGenerated(root)).rejects.toThrow('out of date');
  });
});
