import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  EXTENSIONS,
  MIGRATIONS_DIR,
  SCHEMA_SOURCE_PATH,
  checkGenerated,
  findAppendOnlyTables,
  findNonTenantTables,
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

  it('installs vector and btree_gist on the privileged connection in V001', () => {
    const v001 = generateMigrations(realSchema)[0]?.sql ?? '';
    expect(v001).toContain('SET LOCAL search_path = machvon, public;');
    expect(v001).toContain('CREATE EXTENSION IF NOT EXISTS vector;');
    expect(v001).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist;');
    expect(v001.indexOf('CREATE SCHEMA IF NOT EXISTS machvon')).toBeLessThan(v001.indexOf('CREATE EXTENSION'));
    expect(EXTENSIONS).toEqual(['vector', 'btree_gist']);
  });

  it('keeps V002 free of any statement that needs superuser: only no-op IF NOT EXISTS of V001 extensions', () => {
    const v002 = generateMigrations(realSchema)[1]?.sql ?? '';
    const statements = v002.match(/^\s*CREATE EXTENSION\b.*$/gim) ?? [];
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      const match = /^\s*CREATE EXTENSION IF NOT EXISTS (\w+);/i.exec(statement);
      expect(match).not.toBeNull();
      expect(EXTENSIONS).toContain(match?.[1]);
    }
    expect(v002).not.toMatch(/\b(CREATE|ALTER) (ROLE|USER)\b|\bCREATE (LANGUAGE|SUBSCRIPTION|EVENT TRIGGER)\b|\bALTER SYSTEM\b|\bCOPY\b.*\bPROGRAM\b/i);
  });

  it('finds the eight tables without a tenant_id column', () => {
    expect(findNonTenantTables(realSchema)).toEqual([
      'feature_flag',
      'license_signing_key',
      'notification_event_type',
      'placement',
      'plan_feature',
      'product_plan_version',
      'tenant',
      'user_account',
    ]);
  });

  it('treats a table that gains tenant_id through ALTER TABLE as a tenant table', () => {
    const sql = 'CREATE TABLE a (\n  id uuid\n);\nCREATE TABLE b (\n  id uuid\n);\nALTER TABLE a ADD COLUMN tenant_id uuid NOT NULL;';
    expect(findNonTenantTables(sql)).toEqual(['b']);
  });

  it('finds every append-only table from REVOKE statements and the audit comment', () => {
    expect(findAppendOnlyTables(realSchema)).toEqual([
      'advance_ledger_entry',
      'audit_event',
      'audit_seal',
      'capital_ledger_entry',
      'contract_status_change',
      'cumulative_ledger_entry',
      'issue_event',
      'qms_signature',
    ]);
  });

  it('always treats audit_event as append-only and parses lists in the comment', () => {
    const sql = 'REVOKE UPDATE, DELETE ON x_log FROM PUBLIC;\n-- runtime role has INSERT/SELECT only on a_one, b_two and c_three; trigger.';
    expect(findAppendOnlyTables(sql)).toEqual(['a_one', 'audit_event', 'b_two', 'c_three', 'x_log']);
  });

  it('revokes everything on the control-plane tables and UPDATE, DELETE, TRUNCATE on append-only tables in the V002 footer', () => {
    const v002 = generateMigrations(realSchema)[1]?.sql ?? '';
    const footer = v002.slice(v002.indexOf('-- BEGIN generated: post-schema grants'));
    expect(v002.indexOf('-- BEGIN generated: post-schema grants')).toBeGreaterThan(v002.indexOf(realSchema));
    for (const table of findNonTenantTables(realSchema)) {
      expect(footer).toContain(`REVOKE ALL ON TABLE machvon.${table} FROM machvon_app, machvon_sync, machvon_reporting;`);
    }
    for (const table of findAppendOnlyTables(realSchema)) {
      expect(footer).toContain(`REVOKE UPDATE, DELETE, TRUNCATE ON TABLE machvon.${table} FROM machvon_app;`);
    }
    expect(footer).not.toContain('audit_entry');
  });

  it('re-grants only what the schema itself grants on a control-plane table, after the revoke', () => {
    const sql = [
      'CREATE TABLE feature_flag (\n  id uuid\n);',
      'GRANT SELECT ON feature_flag TO machvon_app;',
      'GRANT SELECT, INSERT ON TABLE machvon.feature_flag TO machvon_sync, machvon_reporting;',
      'GRANT ALL ON tenant_data TO machvon_app;',
      'CREATE TABLE tenant_data (\n  tenant_id uuid\n);',
    ].join('\n');
    const v002 = generateMigrations(sql)[1]?.sql ?? '';
    const revoke = v002.indexOf('REVOKE ALL ON TABLE machvon.feature_flag');
    const regrant = v002.indexOf('GRANT SELECT ON TABLE machvon.feature_flag TO machvon_app;');
    expect(revoke).toBeGreaterThan(v002.indexOf('-- BEGIN generated: post-schema grants'));
    expect(regrant).toBeGreaterThan(revoke);
    expect(v002).toContain('GRANT SELECT, INSERT ON TABLE machvon.feature_flag TO machvon_sync, machvon_reporting;');
    expect(v002).not.toContain('GRANT ALL ON TABLE machvon.tenant_data');
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
