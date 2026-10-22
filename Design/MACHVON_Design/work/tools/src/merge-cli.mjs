import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { ENGINEERING_FILES } from './model.mjs';
import { mergeFragments } from './merge.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('../../../03_Engineering', import.meta.url));
const DEFAULT_STAGING_DIR = fileURLToPath(new URL('../../staging', import.meta.url));
const JSON_SOURCES = ['screens', 'backlog', 'trace', 'tests', 'nonFunctional', 'decisions', 'openapi', 'dictionary'];
const OPTIONAL_SOURCES = new Set(['nonFunctional', 'decisions']);

function readSources(dir) {
  const sources = {};
  for (const name of JSON_SOURCES) {
    const path = join(dir, ENGINEERING_FILES[name]);
    try {
      sources[name] = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      if (!(OPTIONAL_SOURCES.has(name) && error.code === 'ENOENT')) throw error;
      sources[name] = [];
    }
  }
  sources.sql = readFileSync(join(dir, ENGINEERING_FILES.sql), 'utf8');
  return sources;
}

function writeSources(dir, sources) {
  for (const name of JSON_SOURCES) {
    if (OPTIONAL_SOURCES.has(name) && sources[name].length === 0) continue;
    writeFileSync(join(dir, ENGINEERING_FILES[name]), `${JSON.stringify(sources[name], null, 2)}\n`, 'utf8');
  }
  writeFileSync(join(dir, ENGINEERING_FILES.sql), sources.sql, 'utf8');
}

function readFragments(staging) {
  return readdirSync(staging)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(staging, name), 'utf8')));
}

export function main(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR },
      staging: { type: 'string', default: DEFAULT_STAGING_DIR },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const messages = loadMessages(values.locale);
  const dir = resolve(values.dir);
  const fragments = readFragments(resolve(values.staging));
  const { sources, conflicts } = mergeFragments(readSources(dir), fragments);
  if (conflicts.length > 0) {
    for (const conflict of conflicts) {
      log(translate(messages, 'merge.conflict', { ...conflict, modules: conflict.modules.join(', ') }));
    }
    return 1;
  }
  writeSources(dir, sources);
  log(translate(messages, 'merge.done', { count: fragments.length }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
