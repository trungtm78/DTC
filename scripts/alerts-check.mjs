// Checks the alert rules of the platform (ST-KERNEL-051): one JSON file per rule in alerts/rules, each with an owner, a
// runbook that exists, a unique id and a source that the code really emits; the mandatory rules all exist; an
// operations-channel rule is never delivered through the notification module.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const RULES_DIR = 'alerts/rules';
const SEVERITIES = ['critical', 'warning'];
const CHANNELS = ['operations', 'product'];
const ADAPTERS = ['log', 'webhook', 'notification'];
const SOURCE_TYPES = ['event', 'gauge', 'counter'];

export const FINDING_CODES = [
  'ALERT_FILE_INVALID',
  'ALERT_OWNER_MISSING',
  'ALERT_RUNBOOK_MISSING',
  'ALERT_ID_DUPLICATE',
  'ALERT_SOURCE_UNKNOWN',
  'ALERT_VIA_NOTIFICATION',
  'ALERT_RULE_MISSING',
];

/** The mandatory rule ids, read from the kernel so there is one list. */
export function mandatoryRules(root) {
  const text = readFileSync(join(root, 'packages/kernel/src/alerts.ts'), 'utf8');
  const block = /MANDATORY_ALERT_RULES[^=]*=\s*\[([^\]]*)\]/.exec(text);
  return block === null ? [] : [...block[1].matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
}

function sourcesOf(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === 'coverage' || entry === 'dist') continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) files.push(path);
    }
  };
  for (const area of ['packages', 'apps']) {
    for (const name of existsSync(join(root, area)) ? readdirSync(join(root, area)) : []) {
      const src = join(root, area, name, 'src');
      if (existsSync(src)) walk(src);
    }
  }
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

function emittedName(rule) {
  const source = rule.source;
  return source?.type === 'event' ? source.code : source?.metric;
}

/** Returns the findings (`{ code, rule, message }`) for the repository at `root`; an empty list means the rules are sound. */
export function checkAlerts({ root = DEFAULT_ROOT, mandatory = mandatoryRules(root) } = {}) {
  const findings = [];
  const add = (code, rule, message) => findings.push({ code, rule, message });
  const directory = join(root, RULES_DIR);
  const names = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.json')).sort() : [];
  const seen = new Map();
  const rules = [];
  for (const name of names) {
    let rule;
    try {
      rule = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    } catch {
      add('ALERT_FILE_INVALID', name, `${name} is not valid JSON`);
      continue;
    }
    const label = typeof rule?.id === 'string' ? rule.id : name;
    const problems = [];
    if (typeof rule?.id !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(rule.id)) problems.push('id');
    if (!SEVERITIES.includes(rule?.severity)) problems.push('severity');
    if (!CHANNELS.includes(rule?.channel)) problems.push('channel');
    if (!ADAPTERS.includes(rule?.adapter)) problems.push('adapter');
    if (!SOURCE_TYPES.includes(rule?.source?.type)) problems.push('source.type');
    if (typeof rule?.summary !== 'string' || rule.summary.trim() === '') problems.push('summary');
    if (problems.length > 0) {
      add('ALERT_FILE_INVALID', label, `${name}: invalid ${problems.join(', ')}`);
      continue;
    }
    if (typeof rule.owner !== 'string' || rule.owner.trim() === '') add('ALERT_OWNER_MISSING', rule.id, `${rule.id} has no owner`);
    if (typeof rule.runbook !== 'string' || rule.runbook.trim() === '' || !existsSync(join(root, rule.runbook))) add('ALERT_RUNBOOK_MISSING', rule.id, `${rule.id}: the runbook ${rule.runbook ?? '(none)'} does not exist`);
    if (seen.has(rule.id)) add('ALERT_ID_DUPLICATE', rule.id, `${rule.id} is defined in ${seen.get(rule.id)} and ${name}`);
    else seen.set(rule.id, name);
    if (rule.channel === 'operations' && rule.adapter === 'notification') add('ALERT_VIA_NOTIFICATION', rule.id, `${rule.id} is an operations alert and must not be routed through the notification module`);
    rules.push(rule);
  }
  if (rules.length > 0) {
    const code = sourcesOf(root);
    for (const rule of rules) {
      const emitted = emittedName(rule);
      if (typeof emitted !== 'string' || !code.includes(`'${emitted}'`)) add('ALERT_SOURCE_UNKNOWN', rule.id, `${rule.id}: nothing in the code emits '${emitted ?? '(none)'}'`);
    }
  }
  for (const id of mandatory) if (!seen.has(id)) add('ALERT_RULE_MISSING', id, `the mandatory rule ${id} has no file in ${RULES_DIR}`);
  return findings;
}

export function main(root = DEFAULT_ROOT, write = (line) => process.stdout.write(`${line}\n`)) {
  const findings = checkAlerts({ root });
  for (const finding of findings) write(`${finding.code}: ${finding.message}`);
  if (findings.length > 0) {
    write(`${findings.length} alert rule finding(s); see docs/runbooks/alerts`);
    return 1;
  }
  write(`All alert rules are sound (${readdirSync(join(root, RULES_DIR)).filter((name) => name.endsWith('.json')).length} rules)`);
  return 0;
}

if (process.argv[1] !== undefined && relative(process.argv[1], fileURLToPath(import.meta.url)) === '') process.exit(main());
