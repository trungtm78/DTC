import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createMockRoute } from './mock-route.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(SCRIPT_DIR, '..', 'messages');
const DEFAULT_LOCALE = 'vi';
const CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'];
/** Routes that keep data inside Vietnam; the international route only ever sees PUBLIC data. */
const DOMESTIC_KINDS = new Set(['domestic', 'self-hosted', 'mock']);

/** A refusal with the stable code and HTTP status of the error registry. */
export class EvalError extends Error {
  constructor(code, status, detail) {
    super(code);
    this.name = 'EvalError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8'));
}

const words = (text) =>
  text
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

/** Word-level F1 between an answer and the expected answer, after Unicode and case normalisation. */
export function f1Score(actual, expected) {
  const got = words(actual);
  const want = words(expected);
  if (got.length === 0 && want.length === 0) return 1;
  if (got.length === 0 || want.length === 0) return 0;
  const remaining = new Map();
  for (const word of want) remaining.set(word, (remaining.get(word) ?? 0) + 1);
  let overlap = 0;
  for (const word of got) {
    const left = remaining.get(word) ?? 0;
    if (left > 0) {
      overlap += 1;
      remaining.set(word, left - 1);
    }
  }
  if (overlap === 0) return 0;
  const precision = overlap / got.length;
  const recall = overlap / want.length;
  return (2 * precision * recall) / (precision + recall);
}

/** Nearest-rank 95th percentile. */
export function p95(values) {
  if (values.length === 0) throw new RangeError('p95 of no values');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

/** Reads a ground-truth set. It must be signed by a domain expert, non-empty, with unique items of a known classification. */
export function loadDataset(path) {
  let dataset;
  try {
    dataset = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`the dataset is not valid JSON: ${error instanceof Error ? error.message : 'unreadable'}`);
  }
  if (typeof dataset?.signedBy !== 'string' || dataset.signedBy === '') throw new Error('the dataset needs signedBy: the domain expert who signed the ground truth');
  if (!Array.isArray(dataset.items) || dataset.items.length === 0) throw new Error('the dataset needs items');
  const seen = new Set();
  for (const item of dataset.items) {
    if (typeof item?.id !== 'string' || item.id === '') throw new Error('every item needs an id');
    if (seen.has(item.id)) throw new Error(`duplicate item ${item.id}`);
    seen.add(item.id);
    if (typeof item.prompt !== 'string' || typeof item.expected !== 'string') throw new Error(`item ${item.id} needs a prompt and an expected answer`);
    if (!Number.isInteger(item.pages) || item.pages < 1) throw new Error(`item ${item.id} needs pages`);
    if (!CLASSIFICATIONS.includes(item.classification)) throw new Error(`item ${item.id} has an unknown classification`);
  }
  return dataset;
}

/**
 * Runs every item of the dataset through a route and returns the record the gateway profile needs: mean score,
 * p95 latency and cost per 1,000 pages. A route that throws fails the run; an item is never scored as zero for an outage.
 */
export async function evaluateRoute(route, dataset) {
  const scores = [];
  const latencies = [];
  let cost = 0;
  let pages = 0;
  for (const item of dataset.items) {
    const answer = await route.complete(item);
    scores.push(f1Score(answer.text, item.expected));
    latencies.push(answer.latencyMs);
    cost += answer.cost;
    pages += item.pages;
  }
  return {
    route: route.name,
    kind: route.kind,
    items: dataset.items.length,
    pages,
    score: scores.reduce((sum, value) => sum + value, 0) / scores.length,
    p95LatencyMs: p95(latencies),
    costPer1000Pages: (cost / pages) * 1000,
  };
}

/** The same harness over several routes, in order, without any per-route code. */
export async function evaluateAll(routes, dataset) {
  const records = [];
  for (const route of routes) records.push(await evaluateRoute(route, dataset));
  return records;
}

/**
 * Chooses the route from the classification stored with the document. The request may carry a classification too; it
 * is never read, so a forged value cannot move confidential data to the international route. The caller orders
 * `routes` by preference; the first route allowed for the classification wins.
 */
export function selectRoute({ document }, routes) {
  if (!CLASSIFICATIONS.includes(document?.classification)) throw new RangeError('the document has no known classification');
  const allowed = document.classification === 'PUBLIC' ? routes : routes.filter((route) => DOMESTIC_KINDS.has(route.kind));
  const chosen = allowed[0];
  if (chosen === undefined) throw new EvalError('INTERNATIONAL_CLASSIFICATION_NOT_ALLOWED', 422, document.classification);
  return chosen;
}

/** A profile may only be published when every route in it has an eval record (422 EVAL_MISSING_FOR_ROUTE). */
export function checkProfilePublish(profile, records) {
  const evaluated = new Set(records.map((record) => record.route));
  const missing = profile.routes.find((route) => !evaluated.has(route));
  if (missing !== undefined) throw new EvalError('EVAL_MISSING_FOR_ROUTE', 422, missing);
}

function mockRoutes() {
  return [
    createMockRoute({ name: 'mock-domestic', kind: 'mock', accuracy: 1, latencyMs: [120, 180, 240], pricePer1kPages: 6 }),
    createMockRoute({ name: 'mock-self-hosted', kind: 'mock', accuracy: 0.75, latencyMs: [300, 420, 520], pricePer1kPages: 2 }),
  ];
}

export async function main(argv, { log = console.log } = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { dataset: { type: 'string' }, route: { type: 'string' }, locale: { type: 'string', default: DEFAULT_LOCALE } },
    }));
  } catch {
    log(loadMessages(DEFAULT_LOCALE)['aiEval.usage']);
    return 2;
  }
  const messages = loadMessages(values.locale);
  if (values.dataset === undefined) {
    log(messages['aiEval.usage']);
    return 2;
  }
  const routes = mockRoutes().filter((route) => values.route === undefined || route.name === values.route);
  if (routes.length === 0) {
    log(messages['aiEval.route.unknown']);
    return 2;
  }
  let dataset;
  try {
    dataset = loadDataset(resolve(values.dataset));
  } catch (error) {
    log(`${messages['aiEval.dataset.invalid']}: ${error instanceof Error ? error.message : ''}`);
    return 1;
  }
  log(JSON.stringify(await evaluateAll(routes, dataset), null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
