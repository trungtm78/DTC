import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { loadModel, loadModuleSpecs } from './model.mjs';
import { listOperations } from './checks/openapi.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';

// Error-code inventory: finds the UPPER_SNAKE error codes each design source names and reports the
// ones the registry (03_Engineering/error_codes.json) does not know. A token only counts as an error
// code when the source ties it to an HTTP error status ("422 AVC_BLOCKED", "409 A/B") or declares it
// in an OpenAPI x-error-codes list; state names, event names, ids and wildcards never match.

const CODE = String.raw`[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+`;
const TOKEN = String.raw`\`?${CODE}\`?`;
const SEPARATOR = String.raw`[ \t]*(?:/|,|\||\bor\b|\bhoặc\b|\bvà\b|\band\b)[ \t]*`;
// "<4xx|5xx> CODE[/CODE|, CODE ...]": every code of the chain carries the status.
const STATUS_CHAIN = new RegExp(String.raw`\b([45]\d\d)\b[ \t]*(?:[:\-–→]\s*)?(${TOKEN}(?:${SEPARATOR}${TOKEN})*)`, 'g');
const CODE_TOKEN = new RegExp(CODE, 'g');
// Doc 04 (basic design) holds the platform-wide status table; fed to the inventory as one more text source.
export const BASIC_DESIGN_FILE = '04_Thiet_ke_co_ban.md';

export const SOURCE_NAMES = ['specs', 'openapi', 'basicDesign', 'plan', 'tests'];
// Only these sources make the ERROR_CODE_UNREGISTERED check fail; the others are reported by the inventory.
export const ENFORCED_SOURCES = ['openapi', 'plan'];

function lineAround(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end < 0 ? text.length : end);
}

// Entries are evidence: { code, status, where, text } where text is the line that names the code.
export function extractStatusCodes(text, where = null) {
  const source = String(text ?? '');
  const found = [];
  for (const match of source.matchAll(STATUS_CHAIN)) {
    const line = lineAround(source, match.index);
    for (const code of match[2].match(CODE_TOKEN)) found.push({ code, status: Number(match[1]), where, text: line });
  }
  return found;
}

function collectStrings(value, into = []) {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, into));
  return into;
}

// OpenAPI: x-error-codes lists plus status-tied codes inside any description string.
export function extractOpenApi(openapi) {
  const document = openapi ?? { paths: {} };
  const declared = listOperations(document).flatMap(({ operation }) =>
    (operation['x-error-codes'] ?? [])
      .filter((code) => typeof code === 'string')
      .map((code) => ({ code, status: null, where: operation.operationId, text: operation.summary ?? '', tag: operation.tags?.[0] ?? null })),
  );
  return [...declared, ...collectStrings(document).flatMap((text) => extractStatusCodes(text, 'openapi'))];
}

export function extractPlan(plan) {
  return (plan?.stories ?? []).flatMap((story) =>
    (story.acceptance ?? []).flatMap((criterion) =>
      extractStatusCodes(criterion.then, story.id).map((entry) => ({ ...entry, module: story.module ?? null })),
    ),
  );
}

export function extractSpecs(moduleSpecs) {
  return Object.entries(moduleSpecs ?? {}).flatMap(([module, text]) => extractStatusCodes(text, module));
}

export function extractTests(tests) {
  return (tests ?? []).flatMap((item) => collectStrings(item).flatMap((text) => extractStatusCodes(text, item.id)));
}

export function collectSources(model, basicDesignText = '') {
  return {
    specs: extractSpecs(model.moduleSpecs),
    openapi: extractOpenApi(model.openapi),
    basicDesign: extractStatusCodes(basicDesignText, 'basicDesign'),
    plan: extractPlan(model.plan),
    tests: extractTests(model.tests),
  };
}

// The registry knows a code when it is canonical or listed in the structured registry; aliases are
// deliberately excluded because an alias is a spelling that must not be used.
export function registeredCodes(errorCodes) {
  return new Set([...Object.keys(errorCodes?.canonical ?? {}), ...Object.keys(errorCodes?.registry ?? {})]);
}

function sortedUnique(entries) {
  return [...new Set(entries.map((entry) => entry.code))].sort();
}

export function buildInventory(sources, errorCodes) {
  const registered = registeredCodes(errorCodes);
  const excluded = errorCodes?.excluded ?? {};
  const bySource = Object.fromEntries(Object.entries(sources).map(([name, entries]) => [name, sortedUnique(entries)]));
  const missing = {};
  const waived = {};
  for (const [name, codes] of Object.entries(bySource)) {
    for (const code of codes.filter((item) => !registered.has(item))) {
      missing[code] = [...(missing[code] ?? []), name];
    }
  }
  // A documented non-code (shorthand or state name) is waived while only unenforced sources use it.
  for (const [code, where] of Object.entries(missing)) {
    if (code in excluded && !where.some((name) => ENFORCED_SOURCES.includes(name))) {
      waived[code] = where;
      delete missing[code];
    }
  }
  const all = [...new Set(Object.values(bySource).flat())].sort();
  const sortKeys = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return {
    bySource,
    counts: Object.fromEntries(Object.entries(bySource).map(([name, codes]) => [name, codes.length])),
    all,
    registered: registered.size,
    missing: sortKeys(missing),
    waived: sortKeys(waived),
  };
}

export function formatInventory(inventory, messages) {
  const lines = Object.entries(inventory.counts).map(([source, count]) =>
    translate(messages, 'inventory.source', { source, count }),
  );
  lines.push(translate(messages, 'inventory.total', { count: inventory.all.length, registered: inventory.registered }));
  for (const [code, where] of Object.entries(inventory.missing)) {
    lines.push(translate(messages, 'inventory.missing', { code, where: where.join(', ') }));
  }
  for (const [code, where] of Object.entries(inventory.waived)) {
    lines.push(translate(messages, 'inventory.waived', { code, where: where.join(', ') }));
  }
  const count = Object.keys(inventory.missing).length;
  lines.push(translate(messages, count === 0 ? 'inventory.clean' : 'inventory.summary', { count }));
  return lines.join('\n');
}

const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('../../../03_Engineering', import.meta.url));
const DEFAULT_DOCS_DIR = fileURLToPath(new URL('../../../01_Documents', import.meta.url));

export function loadInventoryModel(engineeringDir, docsDir) {
  const basicDesignPath = join(docsDir, BASIC_DESIGN_FILE);
  return {
    model: { ...loadModel(engineeringDir), moduleSpecs: loadModuleSpecs(join(docsDir, '05_modules')) },
    basicDesign: existsSync(basicDesignPath) ? readFileSync(basicDesignPath, 'utf8') : '',
  };
}

export function main(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR },
      docs: { type: 'string', default: DEFAULT_DOCS_DIR },
      locale: { type: 'string', default: DEFAULT_LOCALE },
      json: { type: 'boolean', default: false },
    },
  });
  const { model, basicDesign } = loadInventoryModel(resolve(values.dir), resolve(values.docs));
  const inventory = buildInventory(collectSources(model, basicDesign), model.errorCodes);
  log(values.json ? JSON.stringify(inventory, null, 2) : formatInventory(inventory, loadMessages(values.locale)));
  return Object.keys(inventory.missing).length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
