import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const TOOLS_DIR = 'Design/MACHVON_Design/work/tools';

function readWorkflows() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => ({ name, text: readFileSync(`${WORKFLOWS_DIR}${name}`, 'utf8') }));
}

// Splits a workflow into its steps (list items that start with name: or uses:).
function stepsOf(text) {
  return text.split(/\r?\n\s+- (?=name:|uses:)/).slice(1);
}

const installsRoot = (step) => /run:\s*npm ci\b/.test(step) && !step.includes('working-directory');
const installsTools = (step) => step.includes(`working-directory: ${TOOLS_DIR}`) && /run:\s*npm ci\b/.test(step);
const runsVerify = (step) => step.includes('verify-cli.mjs');

test('there are workflows to check, and at least one runs the protocol gates', () => {
  const workflows = readWorkflows();
  assert.ok(workflows.length >= 2);
  assert.ok(workflows.some(({ text }) => text.includes('verify-cli.mjs')));
});

test('every workflow that runs verify-cli.mjs installs the root and design tools dependencies first, on Node 24', () => {
  const gated = readWorkflows().filter(({ text }) => text.includes('verify-cli.mjs'));
  assert.ok(gated.length >= 2);
  for (const { name, text } of gated) {
    const steps = stepsOf(text);
    const verifyAt = steps.findIndex(runsVerify);
    const rootAt = steps.findIndex(installsRoot);
    const toolsAt = steps.findIndex(installsTools);
    assert.ok(rootAt >= 0 && rootAt < verifyAt, `${name}: root npm ci must run before verify-cli.mjs`);
    assert.ok(toolsAt >= 0 && toolsAt < verifyAt, `${name}: design tools npm ci must run before verify-cli.mjs`);
    assert.match(text, /node-version:\s*24\b/, `${name}: Node 24`);
  }
});

test('the install detectors recognise a workflow that skips the root install', () => {
  const broken = [
    'jobs:',
    '  gates:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    `      - name: Install design tools`,
    `        working-directory: ${TOOLS_DIR}`,
    '        run: npm ci',
    '      - name: Gates',
    '        run: node ci/src/verify-cli.mjs',
  ].join('\n');
  const steps = stepsOf(broken);
  assert.equal(steps.findIndex(installsRoot), -1);
  assert.equal(steps.findIndex(installsTools), 1);
  assert.equal(steps.findIndex(runsVerify), 2);
});
