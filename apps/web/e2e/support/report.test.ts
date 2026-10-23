import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { problemsOf, readReport, recordMissingVisuals, upsertVisual, writeReportPart } from './report.ts';
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

const tempReport = (): string => join(mkdtempSync(join(tmpdir(), 'machvon-stale-')), 'report.json');

test('a visual case of an earlier run becomes stale as soon as a later run writes anything', () => {
  const path = tempReport();
  upsertVisual({ id: 'ADM-01:sidebar', status: 'pass', ratio: 0 }, path, 'run-1');
  upsertVisual({ id: 'ADM-03:sidebar', status: 'fail', ratio: 0.5 }, path, 'run-1');
  upsertVisual({ id: 'state:loading', status: 'pass', ratio: 0 }, path, 'run-2');
  const visual = readReport(path)?.visual ?? [];
  assert.deepEqual(visual.map((entry) => [entry.id, entry.status]), [['ADM-01:sidebar', 'stale'], ['ADM-03:sidebar', 'stale'], ['state:loading', 'pass']]);
  assert.match(visual[0]?.reason ?? '', /earlier run.*pass/);
  assert.match(visual[1]?.reason ?? '', /earlier run.*fail/);
});

test('entries of the running run are kept as they are, and a rerun in the same run replaces its own entry', () => {
  const path = tempReport();
  upsertVisual({ id: 'a', status: 'pending', reason: 'later' }, path, 'run-1');
  upsertVisual({ id: 'b', status: 'pass', ratio: 0 }, path, 'run-1');
  upsertVisual({ id: 'a', status: 'pass', ratio: 0 }, path, 'run-1');
  assert.deepEqual(readReport(path)?.visual?.map((entry) => [entry.id, entry.status, entry.runId]), [['a', 'pass', 'run-1'], ['b', 'pass', 'run-1']]);
});

test('a route walk of an earlier run is marked stale when a later run writes, and a fresh walk is not', () => {
  const path = tempReport();
  writeReportPart({ routeWalk: { routes: 1, entries: [{ ...GOOD, problems: [] }] } }, path, 'run-1');
  assert.equal(readReport(path)?.routeWalk?.stale, undefined);
  upsertVisual({ id: 'a', status: 'pass' }, path, 'run-2');
  assert.equal(readReport(path)?.routeWalk?.stale, true);
  writeReportPart({ routeWalk: { routes: 2, entries: [] } }, path, 'run-3');
  assert.equal(readReport(path)?.routeWalk?.stale, undefined);
  assert.equal(readReport(path)?.visual?.[0]?.status, 'stale');
});

test('a failure before a case could record writes a fail for every case of the test that did not record yet', () => {
  const path = tempReport();
  upsertVisual({ id: 'ADM-01:sidebar', status: 'pass', ratio: 0 }, path, 'run-1');
  upsertVisual({ id: 'ADM-01:heading', status: 'pass', ratio: 0 }, path, 'run-2');
  recordMissingVisuals(['ADM-01:sidebar', 'ADM-01:heading', 'ADM-01:topbar'], 'navigation timed out', path, 'run-2');
  const byId = Object.fromEntries((readReport(path)?.visual ?? []).map((entry) => [entry.id, entry]));
  assert.equal(byId['ADM-01:heading']?.status, 'pass');
  assert.equal(byId['ADM-01:sidebar']?.status, 'fail');
  assert.equal(byId['ADM-01:sidebar']?.reason, 'navigation timed out');
  assert.equal(byId['ADM-01:topbar']?.status, 'fail');
});

test('an entry inherited from a report that predates run ids is stale, never stamped with the current run', () => {
  const path = tempReport();
  writeFileSync(path, JSON.stringify({ generatedAt: 'then', visual: [{ id: 'ADM-01:sidebar', status: 'pass', ratio: 0 }] }));
  upsertVisual({ id: 'ADM-01:heading', status: 'pass', ratio: 0 }, path, 'run-2');
  const byId = Object.fromEntries((readReport(path)?.visual ?? []).map((entry) => [entry.id, entry]));
  assert.equal(byId['ADM-01:sidebar']?.status, 'stale');
  assert.notEqual(byId['ADM-01:sidebar']?.runId, 'run-2');
  assert.match(byId['ADM-01:sidebar']?.reason ?? '', /earlier run.*pass/);
  assert.equal(byId['ADM-01:heading']?.status, 'pass');
  assert.equal(byId['ADM-01:heading']?.runId, 'run-2');
});

test('a case an old report held without a run id still counts as not recorded by this run', () => {
  const path = tempReport();
  writeFileSync(path, JSON.stringify({ generatedAt: 'then', visual: [{ id: 'ADM-01:sidebar', status: 'pass', ratio: 0 }] }));
  recordMissingVisuals(['ADM-01:sidebar'], 'navigation timed out', path, 'run-2');
  const entry = readReport(path)?.visual?.find((candidate) => candidate.id === 'ADM-01:sidebar');
  assert.equal(entry?.status, 'fail');
  assert.equal(entry?.reason, 'navigation timed out');
});
