import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { ENGINEERING_FILES } from './model.mjs';
import { DEFAULT_LOCALE, loadMessages, translate } from './i18n.mjs';
import {
  SOURCE_NAMES,
  buildInventory,
  collectSources,
  loadInventoryModel,
  registeredCodes,
} from './error-code-inventory.mjs';

// Builds registry entries for codes the design sources use but error_codes.json does not list yet.
// Nothing is invented: the status is the one a source states for the code (or the nearest statement,
// or a suffix convention, and the basis is recorded), the meaning is the source text itself.

const CODE_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const STATUS_TOKEN = /\b[45]\d\d\b/g;
const API_METHOD = /^(GET|POST|PUT|PATCH|DELETE)\b/;
const MAX_MEANING_LENGTH = 220;
const DEFAULT_STATUS = 422; // OpenAPI: "422 Domain invariant failure"
const SHARED_MODULE_THRESHOLD = 3;
const KERNEL = 'KERNEL';
const STATUS_BASIS_BY_SOURCE = { specs: 'spec', openapi: 'openapi', basicDesign: 'basic-design', plan: 'plan', tests: 'test' };

const stripMarkup = (text) => text.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
const LEAD_CONTEXT = 90;

// Keeps the part of the text around the code when the whole statement is too long.
function windowAround(text, code) {
  if (text.length <= MAX_MEANING_LENGTH) return text;
  const index = Math.max(text.indexOf(code), 0);
  let start = Math.max(index - LEAD_CONTEXT, 0);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  const end = start + MAX_MEANING_LENGTH;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function nearestStatusBefore(segment, position) {
  let found = null;
  for (const match of segment.matchAll(STATUS_TOKEN)) {
    if (match.index < position) found = Number(match[0]);
  }
  return found;
}

function clauseWith(line, code) {
  const clauses = line.split(/(?<=[.;])\s+/);
  return clauses.find((clause) => clause.includes(code)) ?? line;
}

function tableMentions(line, module) {
  const cells = line.split('|').slice(1, -1);
  const isApiRow = cells.length >= 5 && cells[0].includes('`') && API_METHOD.test(cells[1].trim());
  const description = isApiRow ? `Raised by ${stripMarkup(cells[0])} (${stripMarkup(cells[1])})` : null;
  return cells.flatMap((cell) =>
    [...cell.matchAll(CODE_TOKEN)].map((match) => ({
      code: match[0],
      module,
      kind: isApiRow ? 'api' : 'table',
      status: nearestStatusBefore(cell, match.index),
      text: description ?? stripMarkup(cells.filter((item) => item.includes(match[0])).join(' | ')),
    })),
  );
}

function proseMentions(line, module) {
  return [...line.matchAll(CODE_TOKEN)].map((match) => {
    const sentenceStart = Math.max(line.lastIndexOf('. ', match.index) + 1, 0);
    return {
      code: match[0],
      module,
      kind: 'prose',
      status: nearestStatusBefore(line.slice(sentenceStart), match.index - sentenceStart),
      text: stripMarkup(clauseWith(line, match[0])),
    };
  });
}

// Every place a module spec names a code; UAT rows are test data, not definitions, and are skipped.
export function indexSpecMentions(moduleSpecs) {
  const index = new Map();
  for (const [module, text] of Object.entries(moduleSpecs ?? {})) {
    for (const line of text.split('\n')) {
      if (/^\|\s*UAT-/.test(line)) continue;
      const mentions = line.startsWith('|') ? tableMentions(line, module) : proseMentions(line, module);
      for (const mention of mentions) index.set(mention.code, [...(index.get(mention.code) ?? []), mention]);
    }
  }
  return index;
}

export function humanize(code) {
  const words = code.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  // Map keeps insertion order, so a tie resolves to the first value seen.
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

function statedStatus(evidence) {
  for (const source of SOURCE_NAMES) {
    const statuses = (evidence[source] ?? []).map((entry) => entry.status).filter((status) => status !== null);
    if (statuses.length > 0) return { status: mostFrequent(statuses), basis: STATUS_BASIS_BY_SOURCE[source] };
  }
  return null;
}

const emptyEvidence = () => Object.fromEntries(SOURCE_NAMES.map((name) => [name, []]));

// Evidence per code across every source, so suffix conventions learn from all stated statuses.
function groupEvidence(sources) {
  const byCode = new Map();
  for (const name of SOURCE_NAMES) {
    for (const entry of sources[name] ?? []) {
      const evidence = byCode.get(entry.code) ?? emptyEvidence();
      evidence[name].push(entry);
      byCode.set(entry.code, evidence);
    }
  }
  return byCode;
}

function suffixConvention(code, known) {
  const tokens = code.split('_');
  for (const length of [2, 1]) {
    const suffix = tokens.slice(-length).join('_');
    const peers = [...known].filter(([other]) => other !== code && other.split('_').slice(-length).join('_') === suffix);
    if (peers.length < 2) continue;
    const top = mostFrequent(peers.map(([, status]) => status));
    if (peers.filter(([, status]) => status === top).length * 2 > peers.length) return top;
  }
  return null;
}

function owner(code, mentions, evidence) {
  const modules = (mentions.get(code) ?? []).map((mention) => mention.module);
  if (new Set(modules).size >= SHARED_MODULE_THRESHOLD) return KERNEL;
  if (modules.length > 0) return mostFrequent([...modules].sort());
  const tags = evidence.openapi.map((entry) => entry.tag).filter(Boolean);
  if (new Set(tags).size >= SHARED_MODULE_THRESHOLD) return KERNEL;
  if (tags.length > 0) return mostFrequent([...tags].sort());
  return evidence.plan.find((entry) => entry.module)?.module ?? KERNEL;
}

function meaning(code, ownerModule, mentions, evidence) {
  const all = mentions.get(code) ?? [];
  const inOwner = all.filter((mention) => mention.module === ownerModule);
  for (const kind of ['prose', 'api', 'table']) {
    const found = inOwner.find((mention) => mention.kind === kind) ?? all.find((mention) => mention.kind === kind);
    if (found) return { text: windowAround(found.text, code), source: `spec:${found.module}` };
  }
  const declared = evidence.openapi.find((entry) => 'tag' in entry && entry.text);
  if (declared) return { text: windowAround(`Declared by operation ${declared.where}: ${declared.text}`, code), source: 'openapi' };
  const fallback = ['plan', 'openapi', 'tests', 'basicDesign'].flatMap((name) => evidence[name]).find((entry) => entry.text);
  if (fallback) return { text: windowAround(stripMarkup(clauseWith(fallback.text, code)), code), source: 'text' };
  return { text: humanize(code), source: 'code' };
}

// Entries for `codes`, in sorted order, derived only from the given sources and spec mentions.
export function proposeEntries(sources, mentions, codes) {
  const evidenceOf = groupEvidence(sources);
  const stated = new Map([...evidenceOf].map(([code, evidence]) => [code, statedStatus(evidence)]));
  const nearby = (code) => {
    const status = (mentions.get(code) ?? []).map((mention) => mention.status).find((value) => value !== null);
    return status === undefined ? null : status;
  };
  const known = [...stated].filter(([, value]) => value).map(([code, value]) => [code, value.status]);
  const entries = {};
  for (const code of [...codes].sort()) {
    const evidence = evidenceOf.get(code) ?? emptyEvidence();
    let resolved = stated.get(code);
    if (!resolved && nearby(code) !== null) resolved = { status: nearby(code), basis: 'spec-nearby' };
    if (!resolved) {
      const convention = suffixConvention(code, known);
      resolved = convention === null ? { status: DEFAULT_STATUS, basis: 'default' } : { status: convention, basis: 'convention' };
    }
    const seen = [...new Set(Object.values(evidence).flat().map((entry) => entry.status).filter((status) => status !== null))];
    const module = owner(code, mentions, evidence);
    const described = meaning(code, module, mentions, evidence);
    entries[code] = {
      status: resolved.status,
      title: humanize(code),
      meaning: described.text,
      module,
      statusBasis: resolved.basis,
      source: described.source,
      ...(seen.length > 1 ? { otherStatuses: seen.filter((status) => status !== resolved.status).sort() } : {}),
    };
  }
  return entries;
}

// Add-only merge: canonical, aliases and already registered entries are never replaced.
export function mergeRegistry(errorCodes, proposed) {
  const registry = { ...(errorCodes.registry ?? {}) };
  for (const [code, entry] of Object.entries(proposed)) {
    if (!registeredCodes(errorCodes).has(code)) registry[code] = entry;
  }
  return { ...errorCodes, registry: Object.fromEntries(Object.entries(registry).sort(([a], [b]) => a.localeCompare(b))) };
}

const DEFAULT_ENGINEERING_DIR = fileURLToPath(new URL('../../../03_Engineering', import.meta.url));
const DEFAULT_DOCS_DIR = fileURLToPath(new URL('../../../01_Documents', import.meta.url));

export function main(argv, log = console.log) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string', default: DEFAULT_ENGINEERING_DIR },
      docs: { type: 'string', default: DEFAULT_DOCS_DIR },
      locale: { type: 'string', default: DEFAULT_LOCALE },
      write: { type: 'boolean', default: false },
    },
  });
  const messages = loadMessages(values.locale);
  const dir = resolve(values.dir);
  const { model, basicDesign } = loadInventoryModel(dir, resolve(values.docs));
  const sources = collectSources(model, basicDesign);
  const inventory = buildInventory(sources, model.errorCodes);
  const excluded = model.errorCodes?.excluded ?? {};
  const missing = Object.keys(inventory.missing).filter((code) => !(code in excluded));
  const proposed = proposeEntries(sources, indexSpecMentions(model.moduleSpecs), missing);
  if (values.write) {
    const path = join(dir, ENGINEERING_FILES.errorCodes);
    const current = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, `${JSON.stringify(mergeRegistry(current, proposed), null, 2)}\n`, 'utf8');
  }
  log(values.write ? translate(messages, 'registry.written', { count: missing.length }) : JSON.stringify(proposed, null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
