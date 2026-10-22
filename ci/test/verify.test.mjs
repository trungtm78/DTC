import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBase, runVerification, EMPTY_TREE } from '../src/verify.mjs';
import { formatReport } from '../src/report.mjs';
import { loadMessages } from '../src/i18n.mjs';

const GOOD_PROGRESS = [
  'STATUS: IN_PROGRESS', '# PROGRESS', 'Cập nhật: x',
  '## Đã hoàn thành', '## Đang làm dở', '## Hàng đợi task kế tiếp', '## Quyết định kiến trúc',
  '## Assumption đã tự quyết', '## Trạng thái test', '## Nợ kỹ thuật / rủi ro',
  'BƯỚC TIẾP THEO: next',
].join('\n');

function workspace({ progress = GOOD_PROGRESS } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dtc-verify-'));
  writeFileSync(join(root, 'PROGRESS.md'), progress);
  mkdirSync(join(root, 'work'));
  return root;
}

function fakeRunner(responses) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args].join(' '));
    const key = Object.keys(responses).find((pattern) => calls.at(-1).includes(pattern));
    return key ? responses[key] : { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

const OK = { status: 0, stdout: '', stderr: '' };

test('resolveBase handles explicit refs, CI zero shas and the missing-remote case', () => {
  const git = (known) => (command, args) =>
    command === 'git' && args.includes('--verify') && known.includes(args.at(-1)) ? OK : { status: 1, stdout: '', stderr: '' };
  assert.equal(resolveBase({ explicit: 'abc123', run: git([]) }), 'abc123');
  assert.equal(resolveBase({ explicit: '0'.repeat(40), run: git([]) }), EMPTY_TREE);
  assert.equal(resolveBase({ githubBaseRef: 'main', run: git(['origin/main']) }), 'origin/main');
  assert.equal(resolveBase({ run: git(['origin/main']) }), 'origin/main');
  assert.equal(resolveBase({ run: git([]) }), EMPTY_TREE);
});

test('a clean change set passes every required stage', () => {
  const root = workspace();
  const { run } = fakeRunner({
    'diff ': { status: 0, stdout: 'diff --git a/src/a.mjs b/src/a.mjs\n--- a/src/a.mjs\n+++ b/src/a.mjs\n@@ -1,1 +1,1 @@\n+export const a = 1;\n', stderr: '' },
    'log ': { status: 0, stdout: 'feat: add a\n', stderr: '' },
  });
  const result = runVerification({ root, base: 'origin/main', run, config: { stages: { designCheck: { required: false } } } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stages.map((s) => s.name), ['protocol-scan', 'progress', 'commits', 'design-tests', 'design-check']);
  assert.ok(result.stages.every((s) => s.status === 'pass' || s.status === 'reported'));
});

test('forbidden patterns, bad progress, bad commits and failing tests each fail their stage', () => {
  const root = workspace({ progress: 'no status here' });
  const { run } = fakeRunner({
    'diff ': { status: 0, stdout: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n+// @ts-ignore\n', stderr: '' },
    'log ': { status: 0, stdout: 'Fix things\n', stderr: '' },
    'run test': { status: 1, stdout: 'not ok', stderr: '' },
  });
  const result = runVerification({ root, base: 'b', run, config: { stages: { designCheck: { required: false } } } });
  assert.equal(result.exitCode, 1);
  const status = Object.fromEntries(result.stages.map((s) => [s.name, s.status]));
  // design-check succeeds in this scenario (the fake runner defaults to exit 0), so it passes.
  assert.deepEqual(status, { 'protocol-scan': 'fail', progress: 'fail', commits: 'fail', 'design-tests': 'fail', 'design-check': 'pass' });
});

test('a required design-check stage fails the run; a non-required one only reports', () => {
  const root = workspace();
  const responses = { 'check-cli': { status: 1, stdout: '239 errors', stderr: '' } };
  const required = runVerification({ root, base: 'b', run: fakeRunner(responses).run, config: { stages: { designCheck: { required: true } } } });
  assert.equal(required.exitCode, 1);
  const optional = runVerification({ root, base: 'b', run: fakeRunner(responses).run, config: { stages: { designCheck: { required: false } } } });
  assert.equal(optional.exitCode, 0);
  assert.equal(optional.stages.find((s) => s.name === 'design-check').status, 'reported');
});

test('the Codex review stage is skipped unless requested and never counts as a pass', () => {
  const root = workspace();
  const skipped = runVerification({ root, base: 'b', run: fakeRunner({}).run, config: {}, options: {} });
  assert.equal(skipped.stages.some((s) => s.name === 'codex-review'), false);

  const missing = runVerification({ root, base: 'b', run: (cmd) => (cmd === 'codex' ? { status: 127, stdout: '', stderr: 'not found', error: new Error('ENOENT') } : OK), config: {}, options: { codex: true } });
  assert.equal(missing.stages.find((s) => s.name === 'codex-review').status, 'skipped');
  assert.equal(missing.exitCode, 0);

  const blocking = runVerification({ root, base: 'b', run: (cmd) => (cmd === 'codex' ? { status: 0, stdout: '1. High — tenant leak\nRecommendation: fix because it leaks', stderr: '' } : OK), config: {}, options: { codex: true } });
  assert.equal(blocking.stages.find((s) => s.name === 'codex-review').status, 'fail');
  assert.equal(blocking.exitCode, 1);

  const clean = runVerification({ root, base: 'b', run: (cmd) => (cmd === 'codex' ? { status: 0, stdout: 'No findings.\nRecommendation: ship because clean', stderr: '' } : OK), config: {}, options: { codex: true } });
  assert.equal(clean.stages.find((s) => s.name === 'codex-review').status, 'pass');
});

test('formatReport lists stages and findings from message keys', () => {
  const messages = loadMessages('en');
  const text = formatReport(
    [{ name: 'progress', status: 'fail', findings: [{ code: 'PROGRESS_STATUS_INVALID', severity: 'error', messageKey: 'finding.progressStatusInvalid', params: {} }] }],
    messages,
  );
  assert.match(text, /progress/);
  assert.match(text, /FAIL/i);
  assert.match(text, /STATUS/);
});
