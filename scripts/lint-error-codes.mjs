import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_REGISTRY = join(REPO_ROOT, 'Design', 'MACHVON_Design', '03_Engineering', 'error_codes.json');
const DEFAULT_LOCALE = 'vi';
const WORKSPACE_DIRECTORIES = ['apps', 'packages'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage']);
const THROWN_CODE = /new\s+DomainError\(\s*(['"`])([A-Za-z0-9_]+)\1/g;

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

function registeredCodes(registryPath) {
  const root = JSON.parse(readFileSync(registryPath, 'utf8'));
  if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new Error(`error registry ${registryPath} must be a JSON object`);
  return new Set([...Object.keys(root.canonical ?? {}), ...Object.keys(root.registry ?? {})]);
}

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

function sourceRoots(root) {
  const roots = [];
  for (const workspace of WORKSPACE_DIRECTORIES) {
    const base = join(root, workspace);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const source = join(base, entry.name, 'src');
      if (entry.isDirectory() && existsSync(source)) roots.push(source);
    }
  }
  return roots;
}

// Returns one { file, code } per `new DomainError('CODE'` under packages/*/src and apps/*/src of `root`
// whose CODE is neither a canonical nor a registry entry of the error registry.
export function lintErrorCodes(root, registryPath = DEFAULT_REGISTRY) {
  const known = registeredCodes(registryPath);
  const violations = [];
  for (const source of sourceRoots(root)) {
    for (const file of sourceFiles(source)) {
      for (const match of readFileSync(file, 'utf8').matchAll(THROWN_CODE)) {
        if (!known.has(match[2])) violations.push({ file: relative(root, file).split(sep).join('/'), code: match[2] });
      }
    }
  }
  return violations.sort((a, b) => (a.file === b.file ? 0 : a.file < b.file ? -1 : 1));
}

export function main(argv, { log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string', default: REPO_ROOT },
      registry: { type: 'string', default: DEFAULT_REGISTRY },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const messages = loadMessages(values.locale);
  const violations = lintErrorCodes(resolve(values.root), resolve(values.registry));
  for (const { file, code } of violations) log(format(messages['errorCodes.violation'], { file, code }));
  log(violations.length === 0 ? messages['errorCodes.summary.pass'] : format(messages['errorCodes.summary.fail'], { count: violations.length }));
  return violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
