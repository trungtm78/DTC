import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { loadModel, loadModuleSpecs } from './model.mjs';
import { runChecks } from './checks/index.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('../../../03_Engineering', import.meta.url));
const DEFAULT_SPECS_DIR = fileURLToPath(new URL('../../../01_Documents/05_modules', import.meta.url));
const DEFAULT_LIMIT_PER_CODE = 10;

function groupByCode(findings) {
  const groups = new Map();
  for (const item of findings) groups.set(item.code, [...(groups.get(item.code) ?? []), item]);
  return groups;
}

export function formatReport(findings, messages, { limitPerCode = DEFAULT_LIMIT_PER_CODE } = {}) {
  if (findings.length === 0) return messages['check.report.clean'];
  const groups = groupByCode(findings);
  const lines = [];
  for (const [code, items] of groups) {
    lines.push(`${code} (${items.length})`);
    for (const item of items.slice(0, limitPerCode)) {
      lines.push(`  - ${translate(messages, item.messageKey, item.params)}`);
    }
    if (items.length > limitPerCode) {
      lines.push(`  ${translate(messages, 'check.report.more', { count: items.length - limitPerCode })}`);
    }
  }
  const errors = findings.filter((item) => item.severity === 'error').length;
  lines.push(
    translate(messages, 'check.report.summary', { errors, warnings: findings.length - errors, codes: groups.size }),
  );
  return lines.join('\n');
}

export function main(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR },
      specs: { type: 'string', default: DEFAULT_SPECS_DIR },
      locale: { type: 'string', default: DEFAULT_LOCALE },
      json: { type: 'boolean', default: false },
      limit: { type: 'string', default: String(DEFAULT_LIMIT_PER_CODE) },
    },
  });
  const model = { ...loadModel(resolve(values.dir)), moduleSpecs: loadModuleSpecs(resolve(values.specs)) };
  const findings = runChecks(model);
  const output = values.json
    ? JSON.stringify(findings, null, 2)
    : formatReport(findings, loadMessages(values.locale), { limitPerCode: Number(values.limit) });
  log(output);
  return findings.some((item) => item.severity === 'error') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
