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

/**
 * Removes comments and the content of string literals, so a word inside either never counts as a statement. Comments and
 * strings are read in one pass, left to right: a comment delimiter inside a literal (or a quoted identifier) is text, and a
 * quote inside a comment opens nothing. Block comments nest, as they do in PostgreSQL.
 */
function strip(sql) {
  let out = '';
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const pair = sql.slice(index, index + 2);
    if (pair === '--') {
      while (index < sql.length && sql[index] !== '\n') index += 1;
      out += ' ';
    } else if (pair === '/*') {
      let depth = 0;
      do {
        const here = sql.slice(index, index + 2);
        if (here === '/*') {
          depth += 1;
          index += 2;
        } else if (here === '*/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      } while (index < sql.length && depth > 0);
      out += ' ';
    } else if (char === "'") {
      // An E'...' string also escapes with a backslash.
      const escaping = /[eE]$/.test(out) && !/[\w$]/.test(out.slice(-2, -1));
      index += 1;
      while (index < sql.length) {
        if (escaping && sql[index] === '\\') index += 2;
        else if (sql[index] === "'" && sql[index + 1] === "'") index += 2;
        else if (sql[index] === "'") break;
        else index += 1;
      }
      index += 1;
      out += "''";
    } else if (char === '"') {
      const start = index;
      index += 1;
      while (index < sql.length && !(sql[index] === '"' && sql[index + 1] !== '"')) index += sql[index] === '"' ? 2 : 1;
      index += 1;
      out += sql.slice(start, index);
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
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

// A name is one identifier or a dotted chain of them; an identifier is bare or double-quoted (a quote inside it is doubled), and a
// space inside quotes belongs to the name. The table may be followed by the inheritance marker `*`.
const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[^\s".,;()*]+)`;
const ALTER_TABLE_HEAD = new RegExp(String.raw`^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${IDENTIFIER}(?:\s*\.\s*${IDENTIFIER})*\s*(?:\*\s*)?`, 'i');
// The actions of ALTER TABLE on a column, where PostgreSQL makes the word COLUMN optional ("DROP note", "ALTER note TYPE ...").
const COLUMN_ACTION_DESTRUCTIVE = [
  /^DROP\s+(?!CONSTRAINT\b)/i,
  /^ALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
  /^ALTER\s+(?:COLUMN\s+)?\S+\s+SET\s+NOT\s+NULL\b/i,
  /^RENAME\s+TO\b/i,
  /^RENAME\s+(?!CONSTRAINT\b)(?:COLUMN\s+)?\S+\s+TO\b/i,
];
// A table constraint after ADD is not a column.
const ADD_COLUMN = /^ADD\s+(?!(?:CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN|EXCLUDE)\b)\S/i;

/** The actions of an ALTER TABLE statement, each without the `ALTER TABLE name` head. */
function alterActions(statement) {
  return clausesOf(statement).map((clause, position) => (position === 0 ? clause.replace(ALTER_TABLE_HEAD, '') : clause).trim());
}

const addsColumn = (action) => ADD_COLUMN.test(action);
const addsRequiredColumn = (action) => addsColumn(action) && /\bNOT\s+NULL\b/i.test(action) && !/\bDEFAULT\b/i.test(action);

/** Classifies a statement as `contract` (destroys or tightens something the previous release uses), `expand`, or neither. */
function classify(statement) {
  // The first ALTER TABLE of a DO block follows the opening of the block (`DO $$ BEGIN ALTER TABLE ...`): it is read from there.
  const embedded = /^\s*DO\b/i.test(statement) ? statement.search(/\bALTER\s+TABLE\b/i) : -1;
  return classifyStatement(embedded > 0 ? statement.slice(embedded) : statement);
}

function classifyStatement(statement) {
  const kinds = new Set();
  const isAlterTable = ALTER_TABLE_HEAD.test(statement);
  const parts = isAlterTable ? alterActions(statement) : [statement];
  for (const part of parts) {
    if (DESTRUCTIVE.some((pattern) => pattern.test(part))) kinds.add('contract');
    else if (isAlterTable && COLUMN_ACTION_DESTRUCTIVE.some((pattern) => pattern.test(part))) kinds.add('contract');
    else if (isAlterTable && addsRequiredColumn(part)) kinds.add('contract');
    else if (isAlterTable ? addsColumn(part) : /^\s*CREATE\s+TABLE\b/i.test(part)) kinds.add('expand');
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
