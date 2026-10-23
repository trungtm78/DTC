import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EvalError,
  checkProfilePublish,
  evaluateAll,
  evaluateRoute,
  f1Score,
  loadDataset,
  main,
  p95,
  selectRoute,
} from './ai-eval/harness.mjs';
import { createMockRoute } from './ai-eval/mock-route.mjs';

const ITEMS = [
  { id: 'q1', prompt: 'Thời hạn nộp hồ sơ dự thầu?', expected: 'ngày 30 tháng 11', pages: 10, classification: 'CONFIDENTIAL' },
  { id: 'q2', prompt: 'Giá gói thầu?', expected: '12 tỷ đồng', pages: 20, classification: 'CONFIDENTIAL' },
  { id: 'q3', prompt: 'Hình thức lựa chọn nhà thầu?', expected: 'đấu thầu rộng rãi', pages: 30, classification: 'PUBLIC' },
];
const DATASET = { name: 'tender-sample', signedBy: 'domain-expert-1', items: ITEMS };

const dirs = [];
function datasetFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-eval-'));
  dirs.push(dir);
  const path = join(dir, 'dataset.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}
process.on('exit', () => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

test('f1Score compares normalised words: exact is 1, disjoint is 0, partial is between', () => {
  assert.equal(f1Score('Đấu thầu rộng rãi', 'đấu thầu  rộng rãi'), 1);
  assert.equal(f1Score('hoàn toàn khác', 'đấu thầu rộng rãi'), 0);
  const partial = f1Score('đấu thầu hạn chế', 'đấu thầu rộng rãi');
  assert.ok(partial > 0 && partial < 1);
  assert.equal(f1Score('', ''), 1);
  assert.equal(f1Score('', 'x'), 0);
});

test('p95 is the nearest-rank value and rejects an empty list', () => {
  assert.equal(p95([5]), 5);
  assert.equal(p95(Array.from({ length: 20 }, (_, i) => i + 1)), 19);
  assert.equal(p95([100, 1, 50]), 100);
  assert.throws(() => p95([]), RangeError);
});

test('loadDataset reads a signed ground-truth set and refuses an unsigned, empty or duplicated one', () => {
  assert.equal(loadDataset(datasetFile(DATASET)).items.length, 3);
  assert.throws(() => loadDataset(datasetFile({ ...DATASET, signedBy: '' })), /signedBy/);
  assert.throws(() => loadDataset(datasetFile({ ...DATASET, items: [] })), /items/);
  assert.throws(() => loadDataset(datasetFile({ ...DATASET, items: [ITEMS[0], ITEMS[0]] })), /duplicate/);
  assert.throws(() => loadDataset(datasetFile({ ...DATASET, items: [{ ...ITEMS[0], classification: 'SECRET' }] })), /classification/);
  assert.throws(() => loadDataset(datasetFile({ ...DATASET, items: [{ id: 'x' }] })), /expected/);
  assert.throws(() => loadDataset(datasetFile('{ not json')), /JSON/);
});

test('evaluateRoute records the score, p95 latency and cost per 1,000 pages of a route (AC-ST-KERNEL-004-1)', async () => {
  const route = createMockRoute({ name: 'mock-a', kind: 'mock', accuracy: 1, latencyMs: [100, 200, 300], pricePer1kPages: 4 });
  const record = await evaluateRoute(route, DATASET);
  assert.deepEqual(Object.keys(record).sort(), ['costPer1000Pages', 'items', 'kind', 'p95LatencyMs', 'pages', 'route', 'score']);
  assert.equal(record.route, 'mock-a');
  assert.equal(record.kind, 'mock');
  assert.equal(record.items, 3);
  assert.equal(record.score, 1);
  assert.equal(record.p95LatencyMs, 300);
  assert.equal(record.pages, 60);
  assert.equal(record.costPer1000Pages, 4);
});

test('a less accurate route scores lower with the same harness and no code change (AC-ST-KERNEL-004-1)', async () => {
  const good = createMockRoute({ name: 'good', kind: 'domestic', accuracy: 1, latencyMs: [10], pricePer1kPages: 8 });
  const weak = createMockRoute({ name: 'weak', kind: 'self-hosted', accuracy: 0.5, latencyMs: [10], pricePer1kPages: 2 });
  const records = await evaluateAll([good, weak], DATASET);
  assert.deepEqual(records.map((r) => r.route), ['good', 'weak']);
  assert.ok(records[1].score < records[0].score);
  assert.equal(records[1].costPer1000Pages, 2);
});

test('a route that throws on an item fails the run instead of scoring it as zero', async () => {
  const broken = { name: 'broken', kind: 'domestic', complete: async () => { throw new Error('provider down'); } };
  await assert.rejects(evaluateRoute(broken, DATASET), /provider down/);
});

test('the route is chosen from the server-side classification; a forged client classification is ignored (AC-ST-KERNEL-004-2)', () => {
  const domestic = { name: 'vn-api', kind: 'domestic' };
  const hosted = { name: 'vllm', kind: 'self-hosted' };
  const stub = { name: 'intl-stub', kind: 'international-stub' };
  const routes = [stub, domestic, hosted];
  assert.equal(selectRoute({ document: { classification: 'CONFIDENTIAL' }, request: { classification: 'PUBLIC' } }, routes).name, 'vn-api');
  assert.equal(selectRoute({ document: { classification: 'PUBLIC' }, request: {} }, routes).name, 'intl-stub');
  assert.equal(selectRoute({ document: { classification: 'INTERNAL' } }, [stub, hosted]).name, 'vllm');
  assert.throws(() => selectRoute({ document: { classification: 'CONFIDENTIAL' } }, [stub]), (e) => e instanceof EvalError && e.code === 'INTERNATIONAL_CLASSIFICATION_NOT_ALLOWED' && e.status === 422);
  assert.throws(() => selectRoute({ document: {} }, routes), RangeError);
});

test('publishing a profile needs an eval record for every route: 422 EVAL_MISSING_FOR_ROUTE (AC-ST-KERNEL-004-3)', () => {
  const profile = { name: 'tender', routes: ['vn-api', 'vllm'] };
  const records = [{ route: 'vn-api' }, { route: 'vllm' }];
  assert.doesNotThrow(() => checkProfilePublish(profile, records));
  assert.throws(() => checkProfilePublish(profile, [{ route: 'vn-api' }]), (e) => e instanceof EvalError && e.code === 'EVAL_MISSING_FOR_ROUTE' && e.status === 422 && e.detail === 'vllm');
});

test('main runs the mock routes over a dataset file and prints one JSON record per route', async () => {
  const lines = [];
  const code = await main(['--dataset', datasetFile(DATASET)], { log: (line) => lines.push(line) });
  assert.equal(code, 0);
  const records = JSON.parse(lines.join('\n'));
  assert.ok(records.length >= 2);
  assert.ok(records.every((r) => r.kind === 'mock' || r.route.startsWith('mock')));
});

test('main reports usage errors with exit code 2 and a bad dataset with exit code 1', async () => {
  const lines = [];
  assert.equal(await main([], { log: (line) => lines.push(line) }), 2);
  assert.equal(await main(['--bogus'], { log: (line) => lines.push(line) }), 2);
  assert.equal(await main(['--dataset', datasetFile({ ...DATASET, signedBy: '' })], { log: (line) => lines.push(line) }), 1);
  assert.equal(await main(['--dataset', datasetFile(DATASET), '--route', 'unknown'], { log: (line) => lines.push(line) }), 2);
});
