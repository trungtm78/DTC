import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cruise } from 'dependency-cruiser';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_LOCALE = 'vi';
const SCAN_DIRECTORIES = ['apps', 'packages'];
const require = createRequire(import.meta.url);

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

// Returns one "<file> -> <specifier>" line per forbidden import under apps/ and packages/ of `root`.
// The rules live in the repository's .dependency-cruiser.cjs and apply to any layout shaped like it.
export async function architectureCheck(root) {
  const ruleSet = require(join(REPO_ROOT, '.dependency-cruiser.cjs'));
  const directories = SCAN_DIRECTORIES.filter((name) => existsSync(join(root, name)));
  if (directories.length === 0) return [];
  const result = await cruise(directories, { ...ruleSet.options, ruleSet: { forbidden: ruleSet.forbidden }, baseDir: root, validate: true });
  const specifiers = new Map();
  for (const module of result.output.modules) {
    for (const dependency of module.dependencies) specifiers.set(`${module.source}\n${dependency.resolved}`, dependency.module);
  }
  return result.output.summary.violations
    .filter((violation) => violation.type === 'dependency')
    .map((violation) => `${violation.from} -> ${specifiers.get(`${violation.from}\n${violation.to}`) ?? violation.to}`);
}

export async function main(argv, { log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: { root: { type: 'string', default: REPO_ROOT }, locale: { type: 'string', default: DEFAULT_LOCALE } },
  });
  const messages = loadMessages(values.locale);
  const violations = await architectureCheck(resolve(values.root));
  for (const edge of violations) log(format(messages['architecture.violation'], { edge }));
  log(violations.length === 0 ? messages['architecture.summary.pass'] : format(messages['architecture.summary.fail'], { count: violations.length }));
  return violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
