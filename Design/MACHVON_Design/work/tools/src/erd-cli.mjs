import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { basename, join, resolve } from 'node:path';
import { compareErd, parseErd, renderErd } from './erd.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('../../../03_Engineering', import.meta.url));
const SQL_FILE = 'schema_reference.sql';
const FULL_FILE = 'ERD.mmd';

const normalise = (text) => text.replace(/\r\n/g, '\n');
const moduleFile = (module) => `ERD_${module.toUpperCase()}.mmd`;

function outputFiles({ full, modules }) {
  return new Map([[FULL_FILE, full], ...[...modules].map(([module, text]) => [moduleFile(module), text])]);
}

function describeRelationship(rel) {
  return `${rel.symbol} "${rel.label}"`;
}

function logComparison(report, messages, log) {
  log(translate(messages, 'erd.compare.summary', {
    before: report.entitiesBefore,
    after: report.entitiesAfter,
    relBefore: report.relationshipsBefore,
    relAfter: report.relationshipsAfter,
  }));
  for (const name of report.lostEntities) log(translate(messages, 'erd.compare.entityLost', { name }));
  for (const item of report.changedEntities) {
    log(translate(messages, 'erd.compare.entityChanged', { name: item.name, added: item.added.join('; '), removed: item.removed.join('; ') }));
  }
  for (const item of report.changedRelationships) {
    log(translate(messages, 'erd.compare.relationshipChanged', {
      key: item.key,
      before: describeRelationship(item.before),
      after: describeRelationship(item.after),
    }));
  }
  for (const key of report.lostRelationships) log(translate(messages, 'erd.compare.relationshipLost', { key }));
}

export function erdMain(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR },
      locale: { type: 'string', default: DEFAULT_LOCALE },
      check: { type: 'boolean', default: false },
    },
  });
  const messages = loadMessages(values.locale);
  const dir = resolve(values.dir);
  const rendered = renderErd(readFileSync(join(dir, SQL_FILE), 'utf8'));
  const files = outputFiles(rendered);

  if (values.check) {
    const stale = [...files].filter(([name, text]) => {
      const path = join(dir, name);
      return !existsSync(path) || normalise(readFileSync(path, 'utf8')) !== text;
    });
    for (const [name] of stale) log(translate(messages, 'erd.stale', { file: name }));
    if (stale.length === 0) log(translate(messages, 'erd.upToDate', { count: files.size }));
    return stale.length > 0 ? 1 : 0;
  }

  const fullPath = join(dir, FULL_FILE);
  const previous = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : undefined;
  for (const [name, text] of files) {
    writeFileSync(join(dir, name), text, 'utf8');
    const parsed = parseErd(text);
    log(translate(messages, 'erd.written', {
      file: name,
      entities: [...parsed.entities.values()].filter(Boolean).length,
      relationships: parsed.relationships.length,
    }));
  }
  logComparison(compareErd(previous, rendered.full), messages, log);
  return 0;
}

if (process.argv[1] && basename(fileURLToPath(import.meta.url)) === basename(process.argv[1])) {
  process.exitCode = erdMain(process.argv.slice(2));
}
