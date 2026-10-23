import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINDING_CODES, expandContractCheck, main } from './expand-contract-check.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cleanups = [];

function scratch(files) {
  const root = mkdtempSync(join(tmpdir(), 'machvon-ec-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'db', 'migrations'), { recursive: true });
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(root, 'db', 'migrations', name), sql);
  return root;
}

process.on('exit', () => cleanups.forEach((clean) => clean()));

const codes = (root) => expandContractCheck(root).findings.map((entry) => entry.code);

test('an expand-only migration passes', () => {
  const root = scratch({ 'V003__a.sql': 'CREATE TABLE t (id uuid PRIMARY KEY);\nALTER TABLE t ADD COLUMN note text;\nCREATE INDEX t_note ON t (note);\n' });
  assert.deepEqual(codes(root), []);
});

test('a new NOT NULL column without a default is not an expand step', () => {
  const root = scratch({ 'V003__a.sql': 'ALTER TABLE t ADD COLUMN note text NOT NULL;\n' });
  assert.deepEqual(codes(root), ['CONTRACT_UNDECLARED']);
  const withDefault = scratch({ 'V003__a.sql': "ALTER TABLE t ADD COLUMN note text NOT NULL DEFAULT '';\n" });
  assert.deepEqual(codes(withDefault), []);
});

test('drops, renames, type changes and tightening existing columns need a contract marker', () => {
  for (const sql of [
    'ALTER TABLE t DROP COLUMN note;',
    'DROP TABLE t;',
    'ALTER TABLE t RENAME COLUMN a TO b;',
    'ALTER TABLE t RENAME TO u;',
    'ALTER TABLE t ALTER COLUMN a TYPE bigint;',
    'ALTER TABLE t ALTER COLUMN a SET NOT NULL;',
  ]) {
    assert.deepEqual(codes(scratch({ 'V003__a.sql': `${sql}\n` })), ['CONTRACT_UNDECLARED'], sql);
  }
});

test('statements are found case-insensitively and across lines', () => {
  const root = scratch({ 'V003__a.sql': 'alter table t\n  drop column\n  note;\n' });
  assert.deepEqual(codes(root), ['CONTRACT_UNDECLARED']);
});

test('comments and string literals are ignored', () => {
  const root = scratch({
    'V003__a.sql': "-- DROP TABLE t;\n/* ALTER TABLE t DROP COLUMN x; */\nCREATE TABLE u (note text DEFAULT 'DROP TABLE t');\n",
  });
  assert.deepEqual(codes(root), []);
});

test('a contract marker naming the release that stopped using the object allows the destructive step', () => {
  const marker = '-- contract: drops note; code stopped reading it in release 2026.11\n';
  const root = scratch({ 'V003__a.sql': `${marker}ALTER TABLE t DROP COLUMN note;\n` });
  assert.deepEqual(codes(root), []);
});

test('a marker without a release is invalid', () => {
  const root = scratch({ 'V003__a.sql': '-- contract:\nALTER TABLE t DROP COLUMN note;\n' });
  assert.deepEqual(codes(root), ['CONTRACT_MARKER_INVALID']);
});

test('a marker on a migration that destroys nothing is reported', () => {
  const root = scratch({ 'V003__a.sql': '-- contract: nothing; release 1\nCREATE TABLE t (id uuid);\n' });
  assert.deepEqual(codes(root), ['CONTRACT_MARKER_UNUSED']);
});

test('expand and contract steps must not share a migration', () => {
  const root = scratch({ 'V003__a.sql': '-- contract: drops note; release 1\nALTER TABLE t DROP COLUMN note;\nALTER TABLE t ADD COLUMN other text;\n' });
  assert.deepEqual(codes(root), ['CONTRACT_MIXED_WITH_EXPAND']);
});

test('the generated baseline files are not checked', () => {
  const root = scratch({ 'V001__roles_and_grants.sql': 'DROP TABLE t;\n', 'V002__schema.sql': 'ALTER TABLE t DROP COLUMN a;\n' });
  assert.deepEqual(codes(root), []);
});

test('migrations up to baselineThrough were never released and are exempt; later ones are checked', () => {
  const files = { 'V003__a.sql': 'DROP TABLE t;\n', 'V004__b.sql': 'DROP TABLE u;\n', 'expand-contract.json': '{ "baselineThrough": 3 }' };
  const found = expandContractCheck(scratch(files)).findings;
  assert.deepEqual(found.map((entry) => entry.file), ['V004__b.sql']);
});

test('a policy file that is not valid is a finding', () => {
  assert.deepEqual(codes(scratch({ 'expand-contract.json': '{ "baselineThrough": -1 }' })), ['CONTRACT_POLICY_INVALID']);
  assert.deepEqual(codes(scratch({ 'expand-contract.json': 'nope' })), ['CONTRACT_POLICY_INVALID']);
});

test('a repository without migrations passes', () => {
  assert.deepEqual(codes(mkdtempSync(join(tmpdir(), 'machvon-ec-empty-'))), []);
});

test('every finding code has a message in both languages; main reports file and statement; exit codes', () => {
  for (const locale of ['vi', 'en']) {
    const messages = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'messages', `${locale}.json`), 'utf8'));
    for (const code of FINDING_CODES) assert.ok(messages[`expandContract.${code}`], `${locale} ${code}`);
    for (const key of ['expandContract.summary.pass', 'expandContract.summary.fail', 'expandContract.usage']) assert.ok(messages[key], `${locale} ${key}`);
  }
  const lines = [];
  const root = scratch({ 'V003__a.sql': 'DROP TABLE t;\n' });
  assert.equal(main(['--root', root, '--locale', 'en'], { log: (line) => lines.push(line) }), 1);
  assert.ok(lines.some((line) => line.includes('V003__a.sql') && line.includes('DROP TABLE')));
  assert.equal(main(['--bogus'], { log: () => undefined }), 2);
  assert.equal(main(['--root', REPO_ROOT], { log: () => undefined }), 0);
});
