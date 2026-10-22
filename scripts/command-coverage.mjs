import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_OPENAPI = join(REPO_ROOT, 'Design', 'MACHVON_Design', '03_Engineering', 'openapi.json');
const DEFAULT_LOCALE = 'vi';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage']);
const WRITE_METHODS = ['post', 'put', 'patch', 'delete'];
const WRITE_DECORATOR = /^@(Post|Put|Patch|Delete)\(/;
const OPERATION_ID = /^@OperationId\(\s*['"`]([^'"`]+)['"`]/;
const COMMAND_DECORATOR = /^@Command\(/;

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

function* controllerFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* controllerFiles(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

function applicationSources(root) {
  const base = join(root, 'apps');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'src')))
    .map((entry) => join(base, entry.name, 'src'));
}

// A handler's decorators are the consecutive lines starting with `@` above its signature (one per line).
function* decoratorBlocks(text) {
  let block = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('@')) block.push(line);
    else if (line === '') continue;
    else {
      if (block.length > 0) yield block;
      block = [];
    }
  }
  if (block.length > 0) yield block;
}

function writeOperationIds(openapiPath) {
  const doc = JSON.parse(readFileSync(openapiPath, 'utf8'));
  const ids = [];
  for (const item of Object.values(doc.paths ?? {})) {
    for (const method of WRITE_METHODS) {
      const operation = item[method];
      if (operation !== undefined && typeof operation.operationId === 'string') ids.push(operation.operationId);
    }
  }
  return ids;
}

/**
 * Finds the write handlers (`@Post`, `@Put`, `@Patch`, `@Delete` with `@OperationId`) under apps/(star)/src of
 * `root` and returns the operationIds that lack `@Command` (`uncovered`) and the implemented ones that the
 * OpenAPI document does not define as write operations (`unknown`).
 */
export function commandCoverage(root, openapiPath = DEFAULT_OPENAPI) {
  const defined = new Set(writeOperationIds(openapiPath));
  const implemented = new Set();
  const uncovered = new Set();
  for (const source of applicationSources(root)) {
    for (const file of controllerFiles(source)) {
      for (const block of decoratorBlocks(readFileSync(file, 'utf8'))) {
        if (!block.some((line) => WRITE_DECORATOR.test(line))) continue;
        const id = block.map((line) => OPERATION_ID.exec(line)?.[1]).find((value) => value !== undefined);
        if (id === undefined) continue;
        implemented.add(id);
        if (!block.some((line) => COMMAND_DECORATOR.test(line))) uncovered.add(id);
      }
    }
  }
  return {
    writeOperations: defined.size,
    implemented: [...implemented].sort(),
    uncovered: [...uncovered].sort(),
    unknown: [...implemented].filter((id) => !defined.has(id)).sort(),
  };
}

export function main(argv, { log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string', default: REPO_ROOT },
      openapi: { type: 'string', default: DEFAULT_OPENAPI },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const messages = loadMessages(values.locale);
  const result = commandCoverage(resolve(values.root), resolve(values.openapi));
  for (const id of result.uncovered) log(format(messages['commands.uncovered'], { operation: id }));
  for (const id of result.unknown) log(format(messages['commands.unknown'], { operation: id }));
  const failures = result.uncovered.length + result.unknown.length;
  log(
    failures === 0
      ? format(messages['commands.summary.pass'], { implemented: result.implemented.length, total: result.writeOperations })
      : format(messages['commands.summary.fail'], { count: failures }),
  );
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
