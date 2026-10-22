import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The prototype renders every screen from the SCREENS array by its `kind`, so new screens
// inherit the mockup's shell, tokens and components automatically (decision D-B11).

const CACHE_KEY = /([\w-]+\.(?:css|js))\?v=([0-9A-Za-z]+)/g;
const CACHE_KEY_LENGTH = 12;

// Serialises like the generator that produced the original file: one line, ", " and ": " separators.
function serialize(value) {
  if (Array.isArray(value)) return `[${value.map(serialize).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${serialize(item)}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}

export function renderScreensJs(screens) {
  return `const SCREENS = ${serialize(screens)};`;
}

function contentHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, CACHE_KEY_LENGTH);
}

export function refreshCacheKeys(indexHtml, contents) {
  return indexHtml.replace(CACHE_KEY, (match, file) =>
    file in contents ? `${file}?v=${contentHash(contents[file])}` : match,
  );
}

export function unknownKinds(screens, knownKinds) {
  const known = new Set(knownKinds);
  return [...new Set(screens.map((screen) => screen.kind).filter((kind) => !known.has(kind)))].sort();
}

export function syncPrototype(screens, prototypeDir, { knownKinds }) {
  writeFileSync(join(prototypeDir, 'screens.js'), renderScreensJs(screens), 'utf8');
  const contents = {};
  for (const file of readdirSync(prototypeDir).filter((name) => /\.(css|js)$/.test(name))) {
    contents[file] = readFileSync(join(prototypeDir, file), 'utf8');
  }
  const indexPath = join(prototypeDir, 'index.html');
  writeFileSync(indexPath, refreshCacheKeys(readFileSync(indexPath, 'utf8'), contents), 'utf8');
  return { unknownKinds: unknownKinds(screens, knownKinds) };
}
