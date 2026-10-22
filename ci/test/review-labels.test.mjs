import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REVIEW_ITEMS, loadRules, matchesGlob, missingLabels, requiredLabels, validateRules } from '../src/review-labels.mjs';
import { main } from '../src/review-labels-cli.mjs';

const RULES = loadRules();

test('acceptance: a migration file with no labels leaves review:migration missing', () => {
  const required = requiredLabels(['db/migrations/V003__x.sql'], RULES);
  assert.deepEqual(required, ['review:migration']);
  assert.deepEqual(missingLabels(required, []), ['review:migration']);
});

test('acceptance: review:approved:migration satisfies review:migration', () => {
  const required = requiredLabels(['db/migrations/V003__x.sql'], RULES);
  assert.deepEqual(missingLabels(required, ['review:approved:migration']), []);
});

test('a bare review:<item> label is a request, not an approval', () => {
  assert.deepEqual(missingLabels(['review:migration'], ['review:migration']), ['review:migration']);
});

test('an approval for a different item does not satisfy the requirement', () => {
  assert.deepEqual(missingLabels(['review:money'], ['review:approved:migration', 'bug']), ['review:money']);
});

test('an unrelated file requires nothing', () => {
  assert.deepEqual(requiredLabels(['README.md', 'apps/api/src/main.ts'], RULES), []);
  assert.deepEqual(requiredLabels([], RULES), []);
});

test('required labels are de-duplicated and sorted', () => {
  const files = ['db/migrations/V1.sql', 'db/migrations/V2.sql', 'packages/db/src/x.ts', 'packages/kernel/src/signed-context.ts'];
  assert.deepEqual(requiredLabels(files, RULES), ['review:migration', 'review:security', 'review:tenant-isolation']);
});

test('seed rules map each path family to its labels', () => {
  const cases = [
    ['packages/db/src/tenant-database.ts', ['review:tenant-isolation']],
    ['packages/kernel/src/signed-context.ts', ['review:security', 'review:tenant-isolation']],
    ['packages/kernel/src/tenant-context.ts', ['review:security', 'review:tenant-isolation']],
    ['packages/kernel/src/errors.ts', []],
    ['apps/api/src/pay/pay.service.ts', ['review:money']],
    ['apps/api/src/modules/ledger-entries/x.ts', ['review:money']],
    ['apps/api/src/payment.ts', ['review:money']],
    ['apps/api/src/iam/roles.ts', ['review:authorization']],
    ['apps/api/src/policy-engine.ts', ['review:authorization']],
    ['packages/kernel/src/permission.ts', ['review:authorization']],
    ['Design/MACHVON_Design/03_Engineering/legal_rules.json', ['review:legal-rule']],
    ['apps/api/src/ai/agent.ts', ['review:ai-decision']],
    ['apps/api/src/llm/client.ts', ['review:ai-decision']],
    ['apps/api/src/mail/client.ts', []],
    ['apps/api/src/said/x.ts', []],
  ];
  for (const [file, expected] of cases) {
    assert.deepEqual(requiredLabels([file], RULES), expected, file);
  }
});

test('Windows separators are normalised before matching', () => {
  assert.deepEqual(requiredLabels(['db\\migrations\\V9.sql'], RULES), ['review:migration']);
});

test('matchesGlob supports **, *, ? and escapes regex characters', () => {
  assert.equal(matchesGlob('a/b/c.ts', '**/c.ts'), true);
  assert.equal(matchesGlob('c.ts', '**/c.ts'), true);
  assert.equal(matchesGlob('a/b/c.ts', 'a/*/c.ts'), true);
  assert.equal(matchesGlob('a/b/d/c.ts', 'a/*/c.ts'), false);
  assert.equal(matchesGlob('a/x1.ts', 'a/x?.ts'), true);
  assert.equal(matchesGlob('a/xy1.ts', 'a/x?.ts'), false);
  assert.equal(matchesGlob('a/b.ts', 'a/b.ts'), true);
  assert.equal(matchesGlob('a/bxts', 'a/b.ts'), false);
  assert.equal(matchesGlob('a/b/c', 'a/**'), true);
});

test('every seed label belongs to the closed review vocabulary', () => {
  assert.deepEqual([...REVIEW_ITEMS], ['money', 'authorization', 'tenant-isolation', 'migration', 'legal-template', 'legal-rule', 'ai-decision', 'privacy', 'security']);
  assert.doesNotThrow(() => validateRules(RULES));
  const raw = JSON.parse(readFileSync(new URL('../review-rules.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(raw.rules) && raw.rules.length > 0);
});

test('validateRules rejects labels outside the vocabulary and malformed rules', () => {
  assert.throws(() => validateRules([{ globs: ['x'], labels: ['review:bogus'] }]), /review:bogus/);
  assert.throws(() => validateRules([{ globs: ['x'], labels: ['money'] }]), /money/);
  assert.throws(() => validateRules([{ globs: [], labels: ['review:money'] }]), /globs/);
  assert.throws(() => validateRules([{ globs: ['x'], labels: [] }]), /labels/);
  assert.throws(() => validateRules({}), /array/);
});

function runCli(argv, { files = [], labels, env = {}, status = 0 } = {}) {
  const lines = [];
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return { status, stdout: `${files.join('\n')}\n`, stderr: status === 0 ? '' : 'boom' };
  };
  const fullEnv = { ...env };
  if (labels !== undefined) fullEnv.PR_LABELS = labels;
  const code = main(argv, { log: (text) => lines.push(text), run, env: fullEnv });
  return { code, out: lines.join('\n'), calls };
}

test('cli fails and lists the missing item when no approval label exists', () => {
  const { code, out, calls } = runCli(['--base', 'abc', '--locale', 'en'], { files: ['db/migrations/V003__x.sql'], labels: '[]' });
  assert.equal(code, 1);
  assert.match(out, /review:migration/);
  assert.match(out, /review:approved:migration/);
  assert.deepEqual(calls[0], ['git', 'diff', '--name-only', 'abc...HEAD']);
});

test('cli passes with the approval label and for unrelated changes', () => {
  const approved = runCli(['--base', 'abc', '--locale', 'en'], { files: ['db/migrations/V003__x.sql'], labels: '["review:approved:migration"]' });
  assert.equal(approved.code, 0);
  assert.match(approved.out, /approved for: review:migration/);
  const unrelated = runCli(['--base', 'abc', '--locale', 'en'], { files: ['README.md'], labels: '[]' });
  assert.equal(unrelated.code, 0);
  assert.match(unrelated.out, /No human review/);
});

test('cli reads the base from the environment when no argument is given, and defaults to Vietnamese', () => {
  const { code, out, calls } = runCli([], { files: ['db/migrations/V1.sql'], labels: '[]', env: { REVIEW_BASE: 'def' } });
  assert.equal(code, 1);
  assert.deepEqual(calls[0], ['git', 'diff', '--name-only', 'def...HEAD']);
  assert.match(out, /review:migration/);
  assert.doesNotMatch(out, /approved for/);
});

test('cli fails closed when the base, the labels or git are unusable', () => {
  const noBase = runCli(['--locale', 'en'], { labels: '[]' });
  assert.equal(noBase.code, 1);
  assert.match(noBase.out, /base/i);
  const noLabels = runCli(['--base', 'abc', '--locale', 'en'], {});
  assert.equal(noLabels.code, 1);
  assert.match(noLabels.out, /PR_LABELS/);
  const badJson = runCli(['--base', 'abc', '--locale', 'en'], { labels: '{not json' });
  assert.equal(badJson.code, 1);
  assert.match(badJson.out, /PR_LABELS/);
  const notArray = runCli(['--base', 'abc', '--locale', 'en'], { labels: '{"a":1}' });
  assert.equal(notArray.code, 1);
  assert.match(notArray.out, /PR_LABELS/);
  const gitFails = runCli(['--base', 'abc', '--locale', 'en'], { labels: '[]', status: 128 });
  assert.equal(gitFails.code, 1);
  assert.match(gitFails.out, /git diff/);
});
