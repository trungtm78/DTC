import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadModel } from './model.mjs';
import { buildChangeLog, checkBaseline, collectDiffs, removedParagraphs } from './baseline.mjs';
import { finding } from './checks/finding.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

const PACKAGE_ROOT = new URL('../../../', import.meta.url);
const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('03_Engineering', PACKAGE_ROOT));
const DEFAULT_DOCS_DIR = fileURLToPath(new URL('01_Documents', PACKAGE_ROOT));
const DEFAULT_TAG = 'baseline-v1.3';
const REGISTER_FILE = 'baseline_change_register.json';
const CHANGE_LOG_FILE = 'change_log.json';
const NUMBERED_DOC = /^\d{2}_.+\.md$/;
const PACKAGE_PATH_IN_REPO = 'Design/MACHVON_Design';
const MAX_LOGGED_FINDINGS = 50;

// Materialises the baseline engineering sources and documents from a git tag into memory-backed dirs.
function gitShow(tag, repoPath) {
  const result = spawnSync('git', ['show', `${tag}:${repoPath}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`git show ${tag}:${repoPath} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function loadBaselineFromGit(tag) {
  const read = (name) => gitShow(tag, `${PACKAGE_PATH_IN_REPO}/03_Engineering/${name}`);
  const json = (name) => JSON.parse(read(name));
  return {
    screens: json('screen_catalog.json'),
    backlog: json('implementation_backlog.json'),
    trace: json('traceability.json'),
    tests: json('test_cases.json'),
    decisions: json('implementation_decisions.json'),
    openapi: json('openapi.json'),
    entities: json('data_dictionary.json').entities,
    sql: read('schema_reference.sql'),
  };
}

function loadBaselineFromDir(dir) {
  const json = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  return {
    screens: json('screen_catalog.json'),
    backlog: json('implementation_backlog.json'),
    trace: json('traceability.json'),
    tests: json('test_cases.json'),
    decisions: json('implementation_decisions.json'),
    openapi: json('openapi.json'),
    entities: json('data_dictionary.json').entities,
    sql: readFileSync(join(dir, 'schema_reference.sql'), 'utf8'),
  };
}

function documentFindings({ docsDir, baselineDocsDir, tag }) {
  const names = readdirSync(docsDir).filter((name) => NUMBERED_DOC.test(name));
  return names.flatMap((name) => {
    let baselineText;
    if (baselineDocsDir) {
      const path = join(baselineDocsDir, name);
      baselineText = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    } else {
      baselineText = gitShow(tag, `${PACKAGE_PATH_IN_REPO}/01_Documents/${name}`);
    }
    if (baselineText === undefined) return [];
    const currentText = readFileSync(join(docsDir, name), 'utf8');
    return removedParagraphs(baselineText, currentText).map((paragraph) =>
      finding('BASELINE_PARAGRAPH_UNMAPPED', { file: name, excerpt: paragraph.slice(0, 60) }),
    );
  });
}

export function baselineMain(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      tag: { type: 'string', default: DEFAULT_TAG },
      'baseline-dir': { type: 'string' },
      'baseline-docs': { type: 'string' },
      dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR },
      docs: { type: 'string' },
      locale: { type: 'string', default: DEFAULT_LOCALE },
      only: { type: 'string', default: 'all' },
    },
  });
  const messages = loadMessages(values.locale);
  const engineeringDir = resolve(values.dir);
  const baseline = values['baseline-dir'] ? loadBaselineFromDir(resolve(values['baseline-dir'])) : loadBaselineFromGit(values.tag);
  const current = { ...loadModel(engineeringDir), decisions: JSON.parse(readFileSync(join(engineeringDir, 'implementation_decisions.json'), 'utf8')) };

  const diffs = collectDiffs(baseline, current);
  const registerPath = join(engineeringDir, REGISTER_FILE);
  const register = existsSync(registerPath) ? JSON.parse(readFileSync(registerPath, 'utf8')) : [];
  const changeLog = buildChangeLog(diffs, register);
  writeFileSync(join(engineeringDir, CHANGE_LOG_FILE), `${JSON.stringify(changeLog, null, 2)}\n`, 'utf8');

  const docsDir = values.docs ? resolve(values.docs) : (values['baseline-dir'] ? undefined : DEFAULT_DOCS_DIR);
  const includeRecords = values.only !== 'docs';
  const findings = [
    ...(includeRecords ? checkBaseline(diffs, changeLog) : []),
    ...(docsDir ? documentFindings({ docsDir, baselineDocsDir: values['baseline-docs'] ? resolve(values['baseline-docs']) : undefined, tag: values.tag }) : []),
  ];
  const limit = values.only === 'docs' ? findings.length : MAX_LOGGED_FINDINGS;
  for (const item of findings.slice(0, limit)) log(translate(messages, item.messageKey, item.params));
  if (findings.length > limit) log(translate(messages, 'check.report.more', { count: findings.length - limit }));
  log(translate(messages, 'baseline.summary', { changes: changeLog.length, assigned: changeLog.filter((e) => e.cr).length, errors: findings.length }));
  return findings.length > 0 ? 1 : 0;
}

if (process.argv[1] && basename(fileURLToPath(import.meta.url)) === basename(process.argv[1])) {
  process.exitCode = baselineMain(process.argv.slice(2));
}
