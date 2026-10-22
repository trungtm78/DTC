import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFragments, mergeSqlSection } from '../src/merge.mjs';
import { validModel } from './fixtures.mjs';

function baseSources() {
  const model = validModel();
  return {
    screens: model.screens,
    backlog: model.backlog,
    trace: model.trace,
    tests: model.tests,
    nonFunctional: model.nonFunctional,
    decisions: [{ id: 'D01', status: 'OPEN' }],
    openapi: { paths: structuredClone(model.openapi.paths), components: { schemas: { Money: { type: 'string' } } } },
    dictionary: { version: '1.3', entities: structuredClone(model.entities) },
    sql: model.sql,
  };
}

test('fragments upsert records by id and append new ones', () => {
  const { sources, conflicts } = mergeFragments(baseSources(), [
    {
      module: 'DIS',
      screens: [{ id: 'DIS-01', module: 'DIS', req: 'FR-DIS-01', platform: 'web', title: 'Updated' }, { id: 'DIS-02', module: 'DIS', req: 'FR-DIS-02', platform: 'web' }],
      tests: [{ id: 'UAT-AC68', priority: 'P0', steps: ['a'], expected: 'b', covers: ['FR-DIS-01'] }],
      decisions: [{ id: 'D01', status: 'DECIDED' }],
    },
  ]);
  assert.deepEqual(conflicts, []);
  assert.equal(sources.screens.find((s) => s.id === 'DIS-01').title, 'Updated');
  assert.equal(sources.screens.length, 3);
  assert.equal(sources.tests.at(-1).id, 'UAT-AC68');
  assert.equal(sources.decisions[0].status, 'DECIDED');
});

test('trace rows are keyed by requirement and screen', () => {
  const { sources } = mergeFragments(baseSources(), [
    { module: 'IAM', trace: [{ requirement: 'FR-IAM-01', screen: 'IAM-01', backlog_id: 'BL-IAM-01', test_ids: ['UI-IAM-01'] }] },
  ]);
  assert.equal(sources.trace.length, 2);
  assert.deepEqual(sources.trace[0].test_ids, ['UI-IAM-01']);
});

test('two fragments changing the same record differently are reported as conflicts', () => {
  const { conflicts } = mergeFragments(baseSources(), [
    { module: 'A', tests: [{ id: 'UI-IAM-01', priority: 'P0', steps: ['x'], expected: 'one' }] },
    { module: 'B', tests: [{ id: 'UI-IAM-01', priority: 'P0', steps: ['x'], expected: 'two' }] },
  ]);
  assert.deepEqual(conflicts, [{ collection: 'tests', key: 'UI-IAM-01', modules: ['A', 'B'] }]);
});

test('identical upserts from two fragments are not conflicts', () => {
  const record = { id: 'UI-IAM-01', priority: 'P0', steps: ['x'], expected: 'same' };
  const { conflicts } = mergeFragments(baseSources(), [
    { module: 'A', tests: [record] },
    { module: 'B', tests: [{ ...record }] },
  ]);
  assert.deepEqual(conflicts, []);
});

test('openapi operations merge per path and method; schemas and entities upsert', () => {
  const { sources, conflicts } = mergeFragments(baseSources(), [
    {
      module: 'PAY',
      openapi: {
        paths: { '/reports/{id}/submit': { get: { operationId: 'get_report_submission', 'x-permission': 'report.read' } } },
        schemas: { PaymentLedgerEntry: { type: 'object' } },
      },
      entities: { payment_ledger_entry: { tenant_id: 'uuid', id: 'uuid PK' } },
    },
    { module: 'X', openapi: { paths: { '/reports/{id}/submit': { get: { operationId: 'different', 'x-permission': 'r' } } } } },
  ]);
  const item = sources.openapi.paths['/reports/{id}/submit'];
  assert.ok(item.post && item.get);
  assert.ok(sources.openapi.components.schemas.PaymentLedgerEntry);
  assert.ok(sources.openapi.components.schemas.Money);
  assert.ok(sources.dictionary.entities.payment_ledger_entry);
  assert.deepEqual(conflicts, [{ collection: 'openapi', key: 'GET /reports/{id}/submit', modules: ['PAY', 'X'] }]);
});

test('sql fragments live in one managed section per module and re-merging replaces it', () => {
  const once = mergeSqlSection('CREATE TABLE a (\n  id uuid\n);', 'CTR', 'CREATE TABLE b (\n  id uuid\n);');
  assert.match(once, /-- BEGIN module CTR[\s\S]*CREATE TABLE b[\s\S]*-- END module CTR/);
  const twice = mergeSqlSection(once, 'CTR', 'CREATE TABLE c (\n  id uuid\n);');
  assert.doesNotMatch(twice, /CREATE TABLE b/);
  assert.match(twice, /CREATE TABLE c/);
  assert.equal((twice.match(/-- BEGIN module CTR/g) ?? []).length, 1);
});

test('mergeFragments applies sql sections and leaves the inputs untouched', () => {
  const base = baseSources();
  const before = JSON.stringify(base);
  const { sources } = mergeFragments(base, [{ module: 'AUD', sql: 'CREATE TABLE audit_finding (\n  tenant_id uuid NOT NULL\n);' }]);
  assert.match(sources.sql, /-- BEGIN module AUD/);
  assert.equal(JSON.stringify(base), before);
});
