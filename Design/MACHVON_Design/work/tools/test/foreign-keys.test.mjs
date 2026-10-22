import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FK_MODULE, foreignKeyStatements, mergeFragments, normalizeForeignKeys } from '../src/merge.mjs';
import { normalizeRls } from '../src/rls.mjs';
import { main } from '../src/sql-normalize-cli.mjs';
import { loadMessages } from '../src/i18n.mjs';
import { validModel } from './fixtures.mjs';

const FK_A = 'ALTER TABLE a ADD FOREIGN KEY (tenant_id,b_id) REFERENCES b(tenant_id,id);';
const FK_C = 'ALTER TABLE c ADD FOREIGN KEY (tenant_id,a_id) REFERENCES a(tenant_id,id);';
const table = (name) => `CREATE TABLE ${name} (\n  tenant_id uuid NOT NULL,\n  id uuid NOT NULL\n);`;

// Splits a script into top-level statements, so two scripts can be compared as multisets.
function statementsOf(sql) {
  return sql
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort();
}

const sample = [
  table('b'),
  FK_A,
  '',
  '-- BEGIN module one',
  table('a'),
  FK_C,
  '-- END module one',
  '',
  '-- BEGIN module two',
  table('c'),
  '-- END module two',
  '',
  '-- BEGIN module _RLS',
  'ALTER TABLE a ENABLE ROW LEVEL SECURITY;',
  '-- END module _RLS',
  '',
].join('\n');

test('foreignKeyStatements lists every standalone ADD FOREIGN KEY statement in file order', () => {
  assert.deepEqual(foreignKeyStatements(sample), [FK_A, FK_C]);
});

test('foreignKeyStatements reads statements that span several lines and ignores named constraints', () => {
  const sql = `ALTER TABLE a ADD FOREIGN KEY (x)\n  REFERENCES b(x);\nALTER TABLE a ADD CONSTRAINT a_fk FOREIGN KEY (y) REFERENCES b(y);`;
  assert.deepEqual(foreignKeyStatements(sql), ['ALTER TABLE a ADD FOREIGN KEY (x)\n  REFERENCES b(x);']);
});

test('foreign keys move into a managed section after the modules and before the RLS section', () => {
  const result = normalizeForeignKeys(sample);
  const begin = result.indexOf(`-- BEGIN module ${FK_MODULE}`);
  const end = result.indexOf(`-- END module ${FK_MODULE}`);
  assert.ok(begin > result.indexOf('-- END module two'), 'after the last module');
  assert.ok(end < result.indexOf('-- BEGIN module _RLS'), 'before the RLS section');
  assert.equal(result.slice(0, begin).includes('ADD FOREIGN KEY'), false, 'no foreign key outside the section');
  assert.deepEqual(foreignKeyStatements(result.slice(begin, end)), [FK_A, FK_C]);
  assert.deepEqual(statementsOf(result), statementsOf(sample), 'only the order changes');
});

test('normalizing twice changes nothing', () => {
  const once = normalizeForeignKeys(sample);
  assert.equal(normalizeForeignKeys(once), once);
});

test('a script without foreign keys or an FK section is returned unchanged', () => {
  const sql = `${table('a')}\n`;
  assert.equal(normalizeForeignKeys(sql), sql);
});

test('an empty leftover FK section is dropped', () => {
  const sql = `${table('a')}\n\n-- BEGIN module ${FK_MODULE}\n-- END module ${FK_MODULE}\n`;
  assert.equal(normalizeForeignKeys(sql), `${table('a')}\n`);
});

test('without an RLS section the FK section closes the file', () => {
  const sql = `${table('b')}\n${FK_A}\n${table('a')}\n`;
  const result = normalizeForeignKeys(sql);
  assert.ok(result.trimEnd().endsWith(`-- END module ${FK_MODULE}`));
  assert.ok(result.indexOf('CREATE TABLE a') < result.indexOf(FK_A));
});

test('a module appended after the RLS section still precedes the FK section', () => {
  const appended = `${sample}\n-- BEGIN module three\n${table('d')}\nALTER TABLE d ADD FOREIGN KEY (tenant_id,id) REFERENCES a(tenant_id,id);\n-- END module three\n`;
  const result = normalizeForeignKeys(appended);
  assert.ok(result.indexOf('-- END module three') < result.indexOf(`-- BEGIN module ${FK_MODULE}`));
  assert.ok(result.indexOf(`-- END module ${FK_MODULE}`) < result.indexOf('-- BEGIN module _RLS'));
  assert.equal(foreignKeyStatements(result).length, 3);
  assert.equal(normalizeForeignKeys(result), result);
});

test('dollar signs inside moved statements stay literal', () => {
  const sql = `${table('a')}\nALTER TABLE a ADD FOREIGN KEY (x) REFERENCES b(x); -- keep $& and $'\n`;
  assert.ok(normalizeForeignKeys(sql).includes('REFERENCES b(x);'));
});

test('mergeFragments normalizes foreign keys before row-level security', () => {
  const model = validModel();
  const base = { screens: [], backlog: [], trace: [], tests: [], openapi: { paths: {}, components: {} }, dictionary: { entities: {} }, sql: model.sql };
  const fragment = {
    module: 'late',
    sql: `${table('late_table')}\nALTER TABLE late_table ADD FOREIGN KEY (tenant_id,id) REFERENCES late_table(tenant_id,id);`,
  };
  const { sources } = mergeFragments(base, [fragment]);
  const fk = sources.sql.indexOf(`-- BEGIN module ${FK_MODULE}`);
  const rls = sources.sql.indexOf('-- BEGIN module _RLS');
  assert.ok(sources.sql.indexOf('-- END module late') < fk, 'FK after the new module');
  assert.ok(fk < rls, 'FK before RLS');
  assert.equal(normalizeRls(sources.sql), sources.sql, 'RLS output is stable after the FK pass');
});

test('the CLI rewrites a schema file and reports the moved statements', () => {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-fk-'));
  const file = join(dir, 'schema.sql');
  writeFileSync(file, sample, 'utf8');
  const lines = [];
  assert.equal(main(['--file', file, '--locale', 'en'], (line) => lines.push(line)), 0);
  assert.equal(readFileSync(file, 'utf8'), normalizeForeignKeys(sample));
  assert.match(lines[0], /2 foreign key statement/);
  assert.equal(loadMessages('en')['sqlNormalize.done'].includes('{moved}'), true);
});
