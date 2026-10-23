import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, summarise } from './e2e-report.mjs';

const entry = (id, viewport, problems = []) => ({ id, path: `/x/${id}`, viewport, problems });

const REPORT = {
  generatedAt: '2026-10-23T00:00:00.000Z',
  routeWalk: {
    routes: 2,
    entries: [entry('A-01', '1440'), entry('A-01', '390'), entry('A-02', '1440', ['no breadcrumb']), entry('A-02', '390')],
  },
  visual: [
    { id: 'ADM-01', status: 'pass', ratio: 0.0004 },
    { id: 'ADM-03', status: 'pending', reason: 'not implemented' },
    { id: 'shell-frame:sidebar', status: 'fail', ratio: 0.02 },
  ],
};

function reportFile(report) {
  const path = join(mkdtempSync(join(tmpdir(), 'machvon-e2e-')), 'report.json');
  writeFileSync(path, JSON.stringify(report));
  return path;
}

test('summarise counts routes, pages, broken pages and visual results', () => {
  const summary = summarise(REPORT);
  assert.deepEqual(summary.walk, { stale: false, routes: 2, pages: 4, broken: [{ id: 'A-02', viewport: '1440', problems: ['no breadcrumb'] }] });
  assert.deepEqual(summary.visual, { pass: 1, fail: ['shell-frame:sidebar'], pending: ['ADM-03'], stale: [] });
});

test('summarise tolerates a report without a walk or without visual results', () => {
  assert.deepEqual(summarise({ generatedAt: 'x' }), { walk: undefined, visual: undefined });
});

test('main exits 1 and names the broken route and the failed visual case', () => {
  const lines = [];
  assert.equal(main(['--report', reportFile(REPORT)], { log: (line) => lines.push(line) }), 1);
  assert.ok(lines.some((line) => line.includes('A-02') && line.includes('no breadcrumb')));
  assert.ok(lines.some((line) => line.includes('shell-frame:sidebar')));
});

test('pending visual cases pass unless --require-visual is given', () => {
  const clean = { ...REPORT, routeWalk: { routes: 1, entries: [entry('A-01', '1440')] }, visual: [{ id: 'ADM-03', status: 'pending', reason: 'later' }] };
  assert.equal(main(['--report', reportFile(clean)], { log: () => undefined }), 0);
  const lines = [];
  assert.equal(main(['--report', reportFile(clean), '--require-visual'], { log: (line) => lines.push(line) }), 1);
  assert.ok(lines.some((line) => line.includes('ADM-03')));
});

test('a missing report file is a usage error with exit code 2', () => {
  const lines = [];
  assert.equal(main(['--report', join(tmpdir(), 'machvon-e2e-absent', 'report.json')], { log: (line) => lines.push(line) }), 2);
  assert.equal(lines.length, 1);
});

test('a stale visual case is listed, never counted as a pass, and fails only with --require-visual', () => {
  const report = { ...REPORT, routeWalk: { routes: 1, entries: [entry('A-01', '1440')] }, visual: [{ id: 'ADM-01', status: 'stale', reason: 'not run again' }, { id: 'ADM-03', status: 'pass', ratio: 0 }] };
  assert.deepEqual(summarise(report).visual, { pass: 1, fail: [], pending: [], stale: ['ADM-01'] });
  const lines = [];
  assert.equal(main(['--report', reportFile(report)], { log: (line) => lines.push(line) }), 0);
  assert.ok(lines.some((line) => line.includes('ADM-01')));
  assert.equal(main(['--report', reportFile(report), '--require-visual'], { log: () => undefined }), 1);
});

test('a stale route walk is shown but not judged, and fails only with --require-walk; a missing one too', () => {
  const stale = { ...REPORT, routeWalk: { ...REPORT.routeWalk, stale: true }, visual: undefined };
  const lines = [];
  assert.equal(main(['--report', reportFile(stale)], { log: (line) => lines.push(line) }), 0);
  assert.ok(!lines.some((line) => line.includes('no breadcrumb')));
  assert.equal(main(['--report', reportFile(stale), '--require-walk'], { log: () => undefined }), 1);
  const none = { generatedAt: 'x', visual: [{ id: 'a', status: 'pass' }] };
  assert.equal(main(['--report', reportFile(none)], { log: () => undefined }), 0);
  assert.equal(main(['--report', reportFile(none), '--require-walk'], { log: () => undefined }), 1);
});
