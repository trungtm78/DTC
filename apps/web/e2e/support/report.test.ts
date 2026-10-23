import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { problemsOf, readReport, upsertVisual, writeReportPart } from './report.ts';
import type { RouteWalkEntry } from './report.ts';

const GOOD: Omit<RouteWalkEntry, 'problems'> = {
  id: 'HOME-01',
  path: '/home/home-01',
  viewport: '1440',
  sidebarGroup: true,
  breadcrumb: true,
  activeItem: true,
  consoleErrors: [],
  overflowPx: 0,
};

test('a complete page at 1440 px has no problems', () => {
  assert.deepEqual(problemsOf(GOOD), []);
});

test('each missing part of the frame at 1440 px is a named problem', () => {
  assert.deepEqual(problemsOf({ ...GOOD, sidebarGroup: false }), ['no sidebar group']);
  assert.deepEqual(problemsOf({ ...GOOD, breadcrumb: false }), ['no breadcrumb']);
  assert.deepEqual(problemsOf({ ...GOOD, activeItem: false }), ['no active item']);
  assert.deepEqual(problemsOf({ ...GOOD, overflowPx: 12 }), ['horizontal overflow 12px']);
});

test('console errors and a failed load are problems at any width', () => {
  assert.deepEqual(problemsOf({ ...GOOD, viewport: '390', consoleErrors: ['boom', 'bang'] }), ['console errors: 2']);
  assert.deepEqual(problemsOf({ ...GOOD, loadError: 'timeout' }), ['load: timeout']);
});

test('at 390 px the drawer sidebar, the active item and the overflow are not judged', () => {
  assert.deepEqual(problemsOf({ ...GOOD, viewport: '390', sidebarGroup: false, activeItem: false, overflowPx: 30 }), []);
  assert.deepEqual(problemsOf({ ...GOOD, viewport: '390', breadcrumb: false }), ['no breadcrumb']);
});

test('report parts are merged into one file and keep the other part', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'machvon-report-')), 'nested', 'report.json');
  assert.equal(readReport(path), undefined);
  writeReportPart({ routeWalk: { routes: 1, entries: [{ ...GOOD, problems: [] }] } }, path);
  const merged = writeReportPart({ visual: [{ id: 'ADM-01', status: 'pending', reason: 'not implemented' }] }, path);
  assert.equal(merged.routeWalk?.routes, 1);
  assert.equal(merged.visual?.[0]?.status, 'pending');
  assert.equal(readReport(path)?.visual?.length, 1);
});

test('a visual case is stored at once and replaces an earlier entry of the same id', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'machvon-visual-')), 'report.json');
  upsertVisual({ id: 'ADM-03', status: 'pending', reason: 'later' }, path);
  upsertVisual({ id: 'ADM-01', status: 'fail', ratio: 0.5 }, path);
  upsertVisual({ id: 'ADM-03', status: 'pass', ratio: 0 }, path);
  assert.deepEqual(readReport(path)?.visual?.map((entry) => [entry.id, entry.status]), [['ADM-01', 'fail'], ['ADM-03', 'pass']]);
});
