import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddedLines } from '../src/diff.mjs';
import { scanDiff } from '../src/scan.mjs';
import { CODE_RULES, SECRET_RULES } from '../src/rules.mjs';

function diffFor(file, addedLines) {
  const body = addedLines.map((line) => `+${line}`).join('\n');
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,1 +10,${addedLines.length} @@`,
    ' unchanged context',
    body,
    '',
  ].join('\n');
}

const codes = (findings) => findings.map((f) => f.code).sort();

test('parseAddedLines keeps new-file line numbers and ignores context and removed lines', () => {
  const diff = [
    'diff --git a/src/a.mjs b/src/a.mjs',
    '--- a/src/a.mjs',
    '+++ b/src/a.mjs',
    '@@ -5,3 +7,4 @@',
    ' context',
    '-removed',
    '+first',
    '+second',
    ' tail',
    '',
  ].join('\n');
  assert.deepEqual(parseAddedLines(diff), [
    { file: 'src/a.mjs', line: 8, text: 'first' },
    { file: 'src/a.mjs', line: 9, text: 'second' },
  ]);
});

test('parseAddedLines skips deleted files and binary markers', () => {
  const diff = ['diff --git a/x.png b/x.png', 'Binary files a/x.png and b/x.png differ', 'diff --git a/y.js b/y.js', '--- a/y.js', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-gone', ''].join('\n');
  assert.deepEqual(parseAddedLines(diff), []);
});

test('every banned shortcut from section 5 is detected in code files', () => {
  const added = [
    '// @ts-ignore',
    '/* eslint-disable */',
    'x = 1  # type: ignore',
    'try { run(); } catch (e) { }',
    'except: pass',
    "describe.skip('suite', () => {});",
    "test('a', { skip: true }, () => {});",
    'it.only("focus", () => {});',
    '// TODO tidy this',
    'await sleep(500);',
  ];
  const findings = scanDiff(diffFor('src/service.ts', added), CODE_RULES);
  assert.deepEqual(codes(findings), [
    'DEBT_MARKER',
    'EMPTY_CATCH',
    'EMPTY_CATCH',
    'FIXED_SLEEP',
    'SKIPPED_TEST',
    'SKIPPED_TEST',
    'SKIPPED_TEST',
    'TYPE_SUPPRESSION',
    'TYPE_SUPPRESSION',
    'TYPE_SUPPRESSION',
  ]);
  assert.equal(findings.find((f) => f.code === 'FIXED_SLEEP').severity, 'warning');
  // The hunk starts at line 10 with one context line, so the fourth added line is line 14.
  assert.equal(findings.find((f) => f.code === 'EMPTY_CATCH' && f.params.line === 14).params.line, 14);
});

test('lowering a coverage threshold below 90 is detected, raising it is not', () => {
  const lowered = scanDiff(diffFor('package.json', ['"test": "node --test --test-coverage-lines=80"']), CODE_RULES);
  assert.deepEqual(codes(lowered), ['LOWERED_COVERAGE']);
  assert.deepEqual(scanDiff(diffFor('package.json', ['"test": "node --test --test-coverage-lines=95"']), CODE_RULES), []);
  assert.deepEqual(codes(scanDiff(diffFor('pyproject.toml', ['fail_under = 70']), CODE_RULES)), ['LOWERED_COVERAGE']);
});

test('non-English text in source code is flagged but not in message resources or tests', () => {
  const source = scanDiff(diffFor('src/render.mjs', ['// Tính tổng giải ngân']), CODE_RULES);
  assert.deepEqual(codes(source), ['NON_ENGLISH_CODE']);
  assert.deepEqual(scanDiff(diffFor('src/messages/vi.json', ['"a.b": "Tính tổng"']), CODE_RULES), []);
  assert.deepEqual(scanDiff(diffFor('test/render.test.mjs', ["const t = 'Đăng nhập';"]), CODE_RULES), []);
});

test('documentation files are exempt from code rules', () => {
  assert.deepEqual(scanDiff(diffFor('docs/notes.md', ['TODO write more', '// @ts-ignore']), CODE_RULES), []);
});

test('secrets are detected in any text file', () => {
  const added = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'AKIAABCDEFGHIJKLMNOP',
    `token = "${'ghp_'}${'a'.repeat(36)}"`,
    'api_key: "sk_live_1234567890abcdef"',
  ];
  const findings = scanDiff(diffFor('config/settings.yml', added), SECRET_RULES);
  assert.deepEqual(codes(findings), ['SECRET_FOUND', 'SECRET_FOUND', 'SECRET_FOUND', 'SECRET_FOUND']);
  assert.ok(!JSON.stringify(findings).includes('a'.repeat(36)), 'findings never echo the secret value');
});

test('ignored paths are skipped for both rule sets', () => {
  const diff = diffFor('ci/test/scan.test.mjs', ['// @ts-ignore', 'AKIAABCDEFGHIJKLMNOP']);
  assert.deepEqual(scanDiff(diff, [...CODE_RULES, ...SECRET_RULES]), []);
});

test('clean code produces no findings', () => {
  assert.deepEqual(scanDiff(diffFor('src/clean.ts', ['export const total = (a: number, b: number): number => a + b;']), CODE_RULES), []);
});
