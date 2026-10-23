import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_LOCALE = 'vi';
const MIGRATIONS_DIR = join('db', 'migrations');
const NAME_PATTERN = /^V(\d+)__[a-z0-9_]+\.sql$/;
const POLICY_FILE = 'expand-contract.json';
/** The generator owns these two files; they are the baseline, not a release step. */
const GENERATED = new Set(['V001__roles_and_grants.sql', 'V002__schema.sql']);
const MARKER = /^--\s*contract:(.*)$/im;
const MARKER_RELEASE = /\brelease\s+\S+/i;
const DETAIL_LENGTH = 70;

export const FINDING_CODES = ['CONTRACT_POLICY_INVALID', 'CONTRACT_UNDECLARED', 'CONTRACT_MARKER_INVALID', 'CONTRACT_MARKER_UNUSED', 'CONTRACT_MIXED_WITH_EXPAND'];

const DESTRUCTIVE = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bRENAME\s+(?:COLUMN|TO)\b/i,
  /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
  /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i,
];

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/** Removes comments and the content of string literals, so a word inside either never counts as a statement. */
function strip(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Splits on the commas outside parentheses: the clauses of one ALTER TABLE. */
function clausesOf(statement) {
  const clauses = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      clauses.push(statement.slice(start, index));
      start = index + 1;
    }
  }
  clauses.push(statement.slice(start));
  return clauses;
}

const isAddColumn = (clause) => /\bADD\s+(?:COLUMN\b)/i.test(clause);
const addsRequiredColumn = (clause) => isAddColumn(clause) && /\bNOT\s+NULL\b/i.test(clause) && !/\bDEFAULT\b/i.test(clause);

/** Classifies a statement as `contract` (destroys or tightens something the previous release uses), `expand`, or neither. */
function classify(statement) {
  const clauses = /^\s*ALTER\s+TABLE\b/i.test(statement) ? clausesOf(statement) : [statement];
  const kinds = new Set();
  for (const clause of clauses) {
    if (DESTRUCTIVE.some((pattern) => pattern.test(clause)) || addsRequiredColumn(clause)) kinds.add('contract');
    else if (isAddColumn(clause) || /^\s*CREATE\s+TABLE\b/i.test(clause)) kinds.add('expand');
  }
  return kinds;
}

const shorten = (statement) => statement.replace(/\s+/g, ' ').trim().slice(0, DETAIL_LENGTH);

/** The migrations up to `baselineThrough` were never released: no earlier release runs against them. */
function readBaseline(directory) {
  const path = join(directory, POLICY_FILE);
  if (!existsSync(path)) return { baselineThrough: 0 };
  try {
    const { baselineThrough } = JSON.parse(readFileSync(path, 'utf8'));
    return Number.isInteger(baselineThrough) && baselineThrough >= 0 ? { baselineThrough } : { error: true };
  } catch {
    return { error: true };
  }
}

/**
 * Checks that every hand-written migration is an expand step (additive, the previous release keeps working) or an
 * explicitly marked contract step that comes in its own migration: `-- contract: <what>; release <id>` names the release
 * whose code already stopped using what is destroyed (ST-KERNEL-014).
 */
export function expandContractCheck(root = REPO_ROOT) {
  const directory = join(root, MIGRATIONS_DIR);
  const findings = [];
  if (!existsSync(directory)) return { findings };
  const baseline = readBaseline(directory);
  if (baseline.error) {
    findings.push({ code: 'CONTRACT_POLICY_INVALID', file: POLICY_FILE, detail: 'baselineThrough' });
    return { findings };
  }
  const names = readdirSync(directory)
    .filter((name) => NAME_PATTERN.test(name) && !GENERATED.has(name) && Number(NAME_PATTERN.exec(name)[1]) > baseline.baselineThrough)
    .sort();
  for (const name of names) {
    const raw = readFileSync(join(directory, name), 'utf8');
    const marker = MARKER.exec(raw);
    const statements = strip(raw).split(';').filter((statement) => statement.trim() !== '');
    let firstContract;
    let expands = false;
    for (const statement of statements) {
      const kinds = classify(statement);
      if (kinds.has('contract') && firstContract === undefined) firstContract = statement;
      if (kinds.has('expand')) expands = true;
    }
    if (marker !== null && !MARKER_RELEASE.test(marker[1])) findings.push({ code: 'CONTRACT_MARKER_INVALID', file: name, detail: shorten(marker[0]) });
    else if (marker !== null && firstContract === undefined) findings.push({ code: 'CONTRACT_MARKER_UNUSED', file: name, detail: shorten(marker[0]) });
    else if (marker === null && firstContract !== undefined) findings.push({ code: 'CONTRACT_UNDECLARED', file: name, detail: shorten(firstContract) });
    if (marker !== null && firstContract !== undefined && expands) findings.push({ code: 'CONTRACT_MIXED_WITH_EXPAND', file: name, detail: shorten(firstContract) });
  }
  return { findings };
}

export function main(argv, { log = console.log } = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { root: { type: 'string', default: REPO_ROOT }, locale: { type: 'string', default: DEFAULT_LOCALE } },
    }));
  } catch {
    log(loadMessages(DEFAULT_LOCALE)['expandContract.usage']);
    return 2;
  }
  const messages = loadMessages(values.locale);
  const { findings } = expandContractCheck(resolve(values.root));
  for (const entry of findings) log(`${entry.file}: ${format(messages[`expandContract.${entry.code}`], { detail: entry.detail })}`);
  log(findings.length === 0 ? messages['expandContract.summary.pass'] : format(messages['expandContract.summary.fail'], { count: findings.length }));
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
