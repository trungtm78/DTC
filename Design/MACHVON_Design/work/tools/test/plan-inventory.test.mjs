import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryFromFragment } from '../src/plan-inventory.mjs';

const fragment = {
  module: 'platform',
  screens: [{ id: 'IAM-01', title: 'Login', platform: 'web', phase: 'P0', module: 'IAM' }, { id: 'IAM-01', title: 'dup', platform: 'web', phase: 'P0', module: 'IAM' }],
  openapi: { paths: { '/a': { get: { operationId: 'getA', summary: 'List', 'x-permission': 'a.read', 'x-exposure': 'dto' }, post: { operationId: 'postA', summary: 'Create', 'x-permission': 'a.write' } } } },
  entities: { alpha: { id: 'uuid' }, beta: { id: 'uuid' } },
  tests: [{ id: 'T-1', covers: ['FR-A'] }],
};

test('inventoryFromFragment lists the screens, operations, tables and tests a fragment owns', () => {
  const inventory = inventoryFromFragment(fragment);
  assert.deepEqual(inventory.screens.map((s) => s.id), ['IAM-01']);
  assert.deepEqual(inventory.operations.map((o) => [o.id, o.method, o.path, o.permission]), [['getA', 'GET', '/a', 'a.read'], ['postA', 'POST', '/a', 'a.write']]);
  assert.deepEqual(inventory.tables, ['alpha', 'beta']);
  assert.deepEqual(inventory.tests, ['T-1']);
  assert.equal(inventory.counts.operations, 2);
});

test('an empty fragment yields an empty inventory', () => {
  assert.deepEqual(inventoryFromFragment({ module: 'x' }).counts, { screens: 0, operations: 0, tables: 0, tests: 0 });
});
