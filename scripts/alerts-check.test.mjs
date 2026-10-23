import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FINDING_CODES, checkAlerts, main, mandatoryRules } from './alerts-check.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = [];

/** A small tree: one rule whose runbook and emitted metric exist, plus the kernel list of mandatory rules. */
function tree(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'alerts-check-'));
  scratch.push(root);
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write('packages/kernel/src/alerts.ts', "export const MANDATORY_ALERT_RULES: readonly string[] = [\n  'A_RULE',\n];\n");
  write('packages/db/src/emits.ts', "metrics.gauge('a_metric', 1); alerts.raise('AN_EVENT', {});\n");
  write('docs/runbooks/alerts/A_RULE.md', '# A_RULE\n');
  const rule = { id: 'A_RULE', severity: 'critical', channel: 'operations', owner: 'platform-oncall', runbook: 'docs/runbooks/alerts/A_RULE.md', adapter: 'log', summary: 's', source: { type: 'gauge', metric: 'a_metric', above: 1 } };
  write('alerts/rules/A_RULE.json', JSON.stringify(rule));
  for (const [path, text] of Object.entries(files)) {
    if (text === null) rmSync(join(root, path), { force: true });
    else write(path, typeof text === 'string' ? text : JSON.stringify(text));
  }
  return { root, rule };
}

const codes = (root) => checkAlerts({ root }).map((finding) => finding.code);
const withRule = (rule, extra = {}) => ({ 'alerts/rules/A_RULE.json': rule, ...extra });

after(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

describe('alerts:check on the repository', () => {
  it('finds the nine mandatory rules sound: owners, runbooks, emitted sources, no notification route for operations', () => {
    assert.deepEqual(checkAlerts({ root: REPO }), []);
    assert.equal(mandatoryRules(REPO).length, 9);
    assert.ok(mandatoryRules(REPO).includes('OUTBOX_LAG') && mandatoryRules(REPO).includes('LICENSE_EXPIRING'));
  });

  it('prints the verdict and returns the exit status', () => {
    const lines = [];
    assert.equal(main(REPO, (line) => lines.push(line)), 0);
    assert.match(lines.at(-1), /All alert rules are sound \(9 rules\)/);
    const broken = tree({ 'alerts/rules/A_RULE.json': { id: 'A_RULE' } });
    const out = [];
    assert.equal(main(broken.root, (line) => out.push(line)), 1);
    assert.match(out.join('\n'), /ALERT_FILE_INVALID/);
  });
});

describe('alerts:check defects (scratch trees)', () => {
  it('accepts the sound scratch tree', () => {
    assert.deepEqual(codes(tree().root), []);
  });

  it('fails a rule without an owner (empty or absent)', () => {
    const { root, rule } = tree();
    for (const owner of ['', '  ', undefined]) {
      writeFileSync(join(root, 'alerts/rules/A_RULE.json'), JSON.stringify({ ...rule, owner }));
      assert.deepEqual(codes(root), ['ALERT_OWNER_MISSING']);
    }
  });

  it('fails a rule whose runbook file does not exist', () => {
    const { root, rule } = tree(withRule({}, {}));
    writeFileSync(join(root, 'alerts/rules/A_RULE.json'), JSON.stringify({ ...rule, runbook: 'docs/runbooks/alerts/NOPE.md' }));
    assert.deepEqual(codes(root), ['ALERT_RUNBOOK_MISSING']);
  });

  it('fails two files that define the same id', () => {
    const { root, rule } = tree();
    writeFileSync(join(root, 'alerts/rules/COPY.json'), JSON.stringify(rule));
    assert.deepEqual(codes(root), ['ALERT_ID_DUPLICATE']);
  });

  it('fails a rule whose metric or event code nothing in the code emits', () => {
    const { root, rule } = tree();
    writeFileSync(join(root, 'alerts/rules/A_RULE.json'), JSON.stringify({ ...rule, source: { type: 'gauge', metric: 'never_emitted', above: 1 } }));
    assert.deepEqual(codes(root), ['ALERT_SOURCE_UNKNOWN']);
    writeFileSync(join(root, 'alerts/rules/A_RULE.json'), JSON.stringify({ ...rule, source: { type: 'event', code: 'AN_EVENT' } }));
    assert.deepEqual(codes(root), []);
    writeFileSync(join(root, 'alerts/rules/A_RULE.json'), JSON.stringify({ ...rule, source: { type: 'event', code: 'NEVER_RAISED' } }));
    assert.deepEqual(codes(root), ['ALERT_SOURCE_UNKNOWN']);
  });

  it('does not count an emission that exists only in a test file', () => {
    const { root, rule } = tree({ 'packages/db/src/emits.ts': 'export {};\n', 'packages/db/src/emits.test.ts': "metrics.gauge('a_metric', 1);\n" });
    assert.deepEqual(codes(root), ['ALERT_SOURCE_UNKNOWN']);
    assert.equal(rule.id, 'A_RULE');
  });

  it('fails an operations alert routed through the notification module, and allows a product alert to be', () => {
    const { root, rule } = tree();
    writeFileSync(join(root, 'alerts/rules/A_RULE.json'), JSON.stringify({ ...rule, adapter: 'notification' }));
    assert.deepEqual(codes(root), ['ALERT_VIA_NOTIFICATION']);
    writeFileSync(join(root, 'alerts/rules/A_RULE.json'), JSON.stringify({ ...rule, adapter: 'notification', channel: 'product' }));
    assert.deepEqual(codes(root), []);
  });

  it('fails a mandatory rule that has no file', () => {
    const { root } = tree({ 'packages/kernel/src/alerts.ts': "export const MANDATORY_ALERT_RULES: readonly string[] = ['A_RULE', 'ANOTHER'];\n" });
    assert.deepEqual(checkAlerts({ root }).map((finding) => [finding.code, finding.rule]), [['ALERT_RULE_MISSING', 'ANOTHER']]);
  });

  it('fails a file that is not JSON or has invalid fields, and reports a missing rules directory as missing rules', () => {
    const { root, rule } = tree({ 'alerts/rules/BAD.json': '{not json' });
    assert.deepEqual(codes(root), ['ALERT_FILE_INVALID']);
    for (const bad of [{ ...rule, id: 'lower' }, { ...rule, severity: 'fatal' }, { ...rule, channel: 'x' }, { ...rule, adapter: 'smoke' }, { ...rule, source: { type: 'magic' } }, { ...rule, summary: '' }, null]) {
      writeFileSync(join(root, 'alerts/rules/BAD.json'), JSON.stringify(bad));
      assert.ok(codes(root).includes('ALERT_FILE_INVALID'), JSON.stringify(bad));
    }
    const empty = mkdtempSync(join(tmpdir(), 'alerts-empty-'));
    scratch.push(empty);
    mkdirSync(join(empty, 'packages/kernel/src'), { recursive: true });
    writeFileSync(join(empty, 'packages/kernel/src/alerts.ts'), "export const MANDATORY_ALERT_RULES: readonly string[] = ['ONLY'];\n");
    assert.deepEqual(codes(empty), ['ALERT_RULE_MISSING']);
  });

  it('declares every finding code it can report', () => {
    assert.deepEqual([...FINDING_CODES].sort(), ['ALERT_FILE_INVALID', 'ALERT_ID_DUPLICATE', 'ALERT_OWNER_MISSING', 'ALERT_RULE_MISSING', 'ALERT_RUNBOOK_MISSING', 'ALERT_SOURCE_UNKNOWN', 'ALERT_VIA_NOTIFICATION']);
    assert.ok(existsSync(join(REPO, 'docs/runbooks/alerts/README.md')) && readFileSync(join(REPO, 'docs/runbooks/alerts/README.md'), 'utf8').includes('operations channel'));
    assert.ok(cpSync);
  });
});
