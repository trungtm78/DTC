import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { syncPrototype } from './prototype-sync.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

const DEFAULT_CATALOG = fileURLToPath(new URL('../../../03_Engineering/screen_catalog.json', import.meta.url));
const DEFAULT_PROTOTYPE_DIR = fileURLToPath(new URL('../../../02_Prototype', import.meta.url));
const SCREENS_PREFIX = /^\s*const SCREENS = /;

// The renderer dispatches on `k==='kind'` and `['a','b'].includes(k)` inside content() only.
export function knownKindsFromApp(appSource) {
  const start = appSource.indexOf('function content(');
  if (start < 0) return [];
  const end = appSource.indexOf('function paper(', start);
  const body = appSource.slice(start, end < 0 ? undefined : end);
  const kinds = new Set();
  for (const match of body.matchAll(/\bk===?['"]([a-z]+)['"]/g)) kinds.add(match[1]);
  for (const list of body.matchAll(/\[((?:'[a-z]+',?\s*)+)\]\.includes\(k\)/g)) {
    for (const kind of list[1].matchAll(/'([a-z]+)'/g)) kinds.add(kind[1]);
  }
  return [...kinds].sort();
}

export function parseScreensJs(source) {
  if (!source.trim()) return [];
  return JSON.parse(source.replace(SCREENS_PREFIX, '').replace(/;\s*$/, ''));
}

// A regenerated catalog may add entries, keys and list items; it must never remove any.
export function findRegressions(before, after) {
  const next = new Map(after.map((screen) => [screen.id, screen]));
  const found = [];
  for (const old of before) {
    const updated = next.get(old.id);
    if (!updated) {
      found.push({ id: old.id, kind: 'entry' });
      continue;
    }
    for (const [key, value] of Object.entries(old)) {
      if (!(key in updated)) {
        found.push({ id: old.id, kind: 'key', key });
      } else if (Array.isArray(value)) {
        for (const item of value.filter((entry) => !updated[key].includes(entry))) {
          found.push({ id: old.id, kind: 'item', key, item });
        }
      }
    }
  }
  return found;
}

function describe(messages, regression) {
  return translate(messages, `sync.regression.${regression.kind}`, regression);
}

export function syncMain(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      catalog: { type: 'string', default: DEFAULT_CATALOG },
      prototype: { type: 'string', default: DEFAULT_PROTOTYPE_DIR },
      locale: { type: 'string', default: DEFAULT_LOCALE },
    },
  });
  const messages = loadMessages(values.locale);
  const prototypeDir = resolve(values.prototype);
  const screens = JSON.parse(readFileSync(resolve(values.catalog), 'utf8'));
  const screensPath = join(prototypeDir, 'screens.js');
  const before = existsSync(screensPath) ? parseScreensJs(readFileSync(screensPath, 'utf8')) : [];
  const regressions = findRegressions(before, screens);
  if (regressions.length > 0) {
    for (const regression of regressions) log(describe(messages, regression));
    return 1;
  }
  const knownKinds = knownKindsFromApp(readFileSync(join(prototypeDir, 'app.js'), 'utf8'));
  const { unknownKinds } = syncPrototype(screens, prototypeDir, { knownKinds });
  log(translate(messages, 'sync.summary', { total: screens.length, added: screens.length - before.length }));
  for (const kind of unknownKinds) log(translate(messages, 'sync.unknownKind', { kind }));
  return unknownKinds.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = syncMain(process.argv.slice(2));
}
