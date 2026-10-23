import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBLEM_CODES, STAGING_CONTEXT, evaluateProductionGate, main, productionContext, readCanaryPolicy } from './deploy-gate.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const COHORTS = ['pilot', 'cohort-1', 'all'];
const NOW = Date.parse('2026-06-01T12:00:00Z');
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const greenRun = { head_sha: SHA, status: 'completed', conclusion: 'success' };
const staging = (state = 'success') => ({ context: STAGING_CONTEXT, state, created_at: minutesAgo(600) });
const production = (cohort, minutes, state = 'success') => ({ context: productionContext(cohort), state, created_at: minutesAgo(minutes) });

function gate(overrides = {}) {
  return evaluateProductionGate({
    sha: SHA,
    cohort: 'pilot',
    cohorts: COHORTS,
    bakeMinutes: 30,
    ciRuns: [greenRun],
    statuses: [staging()],
    now: NOW,
    ...overrides,
  }).problems.map((problem) => problem.code);
}

test('a commit with green CI and a green staging deployment may go to the first cohort', () => {
  assert.deepEqual(gate(), []);
});

test('a commit whose CI never succeeded is refused', () => {
  assert.deepEqual(gate({ ciRuns: [] }), ['CI_NOT_GREEN']);
  assert.deepEqual(gate({ ciRuns: [{ ...greenRun, conclusion: 'failure' }] }), ['CI_NOT_GREEN']);
  assert.deepEqual(gate({ ciRuns: [{ ...greenRun, status: 'in_progress', conclusion: null }] }), ['CI_NOT_GREEN']);
  assert.deepEqual(gate({ ciRuns: [{ ...greenRun, head_sha: OTHER_SHA }] }), ['CI_NOT_GREEN']);
});

test('a commit that never reached staging, or whose latest staging deployment failed, is refused', () => {
  assert.deepEqual(gate({ statuses: [] }), ['STAGING_NOT_GREEN']);
  assert.deepEqual(gate({ statuses: [staging('failure')] }), ['STAGING_NOT_GREEN']);
  // The API lists the newest status first: a later failure outranks an earlier success.
  assert.deepEqual(gate({ statuses: [staging('failure'), staging('success')] }), ['STAGING_NOT_GREEN']);
  assert.deepEqual(gate({ statuses: [staging('success'), staging('failure')] }), []);
});

test('a short or symbolic revision is not a promotable commit', () => {
  assert.deepEqual(gate({ sha: 'main' }), ['SHA_INVALID', 'CI_NOT_GREEN']);
});

test('the canary order and the bake time are enforced for the later cohorts', () => {
  assert.deepEqual(gate({ cohort: 'cohort-1' }), ['PREVIOUS_COHORT_MISSING']);
  assert.deepEqual(gate({ cohort: 'cohort-1', statuses: [production('pilot', 10), staging()] }), ['BAKE_NOT_ELAPSED']);
  assert.deepEqual(gate({ cohort: 'cohort-1', statuses: [production('pilot', 30), staging()] }), []);
  assert.deepEqual(gate({ cohort: 'all', statuses: [production('pilot', 500), staging()] }), ['PREVIOUS_COHORT_MISSING']);
  assert.deepEqual(gate({ cohort: 'all', statuses: [production('cohort-1', 31), production('pilot', 500), staging()] }), []);
  assert.deepEqual(gate({ cohort: 'all', statuses: [production('cohort-1', 31, 'failure'), staging()] }), ['PREVIOUS_COHORT_MISSING']);
});

test('an unknown cohort is refused', () => {
  assert.deepEqual(gate({ cohort: 'everyone' }), ['COHORT_UNKNOWN']);
});

test('the canary policy is read from the production pipeline declaration', () => {
  const policy = readCanaryPolicy(REPO_ROOT);
  assert.deepEqual(policy.cohorts, COHORTS);
  assert.equal(policy.bakeMinutes, 30);
});

function fakeApi({ runs = [greenRun], statuses = [staging()] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body), authorization: init.headers.authorization });
    const body = url.includes('/actions/workflows/') ? { workflow_runs: runs } : url.includes('/statuses') && init.method === 'GET' ? statuses : {};
    return { ok: true, status: 200, json: async () => body };
  };
  return { calls, fetchImpl };
}

const run = (argv, api, env = { GH_TOKEN: 'token', GITHUB_API_URL: 'https://api.example.test' }) => {
  const lines = [];
  return main(argv, { log: (line) => lines.push(line), fetchImpl: api.fetchImpl, env, now: NOW }).then((code) => ({ code, lines }));
};

test('check exits 0 and names the commit when every gate is met', async () => {
  const api = fakeApi();
  const { code, lines } = await run(['check', '--locale', 'en', '--repo', 'o/r', '--sha', SHA, '--cohort', 'pilot'], api);
  assert.equal(code, 0);
  assert.match(lines.at(-1), new RegExp(`commit ${SHA} may be promoted to pilot`));
  assert.ok(api.calls.every((call) => call.url.startsWith('https://api.example.test/repos/o/r/') && call.authorization === 'Bearer token'));
  assert.ok(api.calls.some((call) => call.url.includes(`/actions/workflows/ci.yml/runs?head_sha=${SHA}`)));
});

test('check exits 1 and prints every unmet gate', async () => {
  const { code, lines } = await run(['check', '--locale', 'en', '--repo', 'o/r', '--sha', SHA, '--cohort', 'cohort-1'], fakeApi({ runs: [], statuses: [] }));
  assert.equal(code, 1);
  assert.equal(lines.length, 4);
  assert.match(lines.at(-1), /3 promotion gate\(s\) not met/);
});

test('record writes a commit status on the exact commit', async () => {
  const api = fakeApi();
  const { code, lines } = await run(['record', '--locale', 'en', '--repo', 'o/r', '--sha', SHA, '--context', 'deploy/staging', '--state', 'success', '--description', 'Deployed'], api);
  assert.equal(code, 0);
  assert.deepEqual(api.calls.map((call) => [call.method, call.url]), [['POST', `https://api.example.test/repos/o/r/statuses/${SHA}`]]);
  assert.deepEqual(api.calls[0].body, { state: 'success', context: 'deploy/staging', description: 'Deployed' });
  assert.match(lines[0], /recorded deploy\/staging as success/);
});

test('a failing API call is an error, never a pass', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(() => run(['check', '--repo', 'o/r', '--sha', SHA, '--cohort', 'pilot'], { fetchImpl }), /HTTP 403/);
});

test('missing or unknown arguments print the usage and exit 2', async () => {
  for (const argv of [['--nope'], [], ['check', '--repo', 'o/r'], ['record', '--repo', 'o/r', '--sha', SHA, '--context', 'c', '--state', 'maybe']]) {
    const { code, lines } = await run(argv, fakeApi());
    assert.equal(code, 2, argv.join(' '));
    assert.match(lines[0], /^(usage|cách\sdùng)/);
  }
});

test('every problem code has a message in both catalogues', () => {
  for (const locale of ['vi', 'en']) {
    const messages = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'messages', `${locale}.json`), 'utf8'));
    for (const code of PROBLEM_CODES) assert.ok(messages[`deployGate.${code}`], `${locale} ${code}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The workflow wires the gate in: these checks read the text because the repository has no YAML parser dependency.
// ---------------------------------------------------------------------------------------------------------------------

const WORKFLOW = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
const jobBlock = (name) => {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name}`);
  const rest = WORKFLOW.slice(start + 1);
  const next = /\n {2}[a-z-]+:\n/.exec(rest.slice(1));
  return next === null ? rest : rest.slice(0, next.index + 1);
};

test('the commit is resolved once, in preflight, and exposed as an output', () => {
  const preflight = jobBlock('preflight');
  assert.match(preflight, /outputs:\n\s+sha: \$\{\{ steps\.resolve\.outputs\.sha \}\}/);
  assert.match(preflight, /git rev-parse HEAD/);
});

test('staging, the gate and production check out the preflight SHA, never a moving ref', () => {
  for (const name of ['staging', 'gate', 'production']) {
    const block = jobBlock(name);
    assert.match(block, /ref: \$\{\{ needs\.preflight\.outputs\.sha \}\}/, name);
    assert.doesNotMatch(block, /inputs\.ref|workflow_run\.head_sha/, name);
  }
});

test('production waits for the gate and checks it again before running the command', () => {
  const production = jobBlock('production');
  assert.match(production, /needs: \[preflight, gate\]/);
  const check = production.indexOf('deploy-gate.mjs check');
  const command = production.indexOf('bash -c "$DEPLOY_COMMAND"');
  const record = production.indexOf('deploy-gate.mjs record');
  assert.ok(check > 0 && check < command && command < record, 'check, then deploy, then record');
  assert.match(jobBlock('gate'), /deploy-gate\.mjs check/);
});

test('staging records its evidence only after a real deployment', () => {
  const staging = jobBlock('staging');
  assert.match(staging, /if: success\(\) && vars\.DEPLOY_COMMAND_STAGING != ''/);
  assert.match(staging, /--context deploy\/staging --state success/);
  assert.match(staging, /statuses: write/);
});
