import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectRoutes } from './routes-filter.ts';

const ROUTES = [{ id: 'HOME-01' }, { id: 'ADM-01' }, { id: 'PRJ-01' }];

test('without a selection every route is walked', () => {
  assert.deepEqual(selectRoutes(ROUTES, undefined), { selected: ROUTES, unknown: [] });
  assert.deepEqual(selectRoutes(ROUTES, ''), { selected: ROUTES, unknown: [] });
  assert.deepEqual(selectRoutes(ROUTES, ' , '), { selected: ROUTES, unknown: [] });
});

test('a selection keeps the table order and trims the ids', () => {
  assert.deepEqual(selectRoutes(ROUTES, ' PRJ-01, HOME-01 '), { selected: [ROUTES[0], ROUTES[2]], unknown: [] });
});

test('ids that are not in the table are reported, never dropped silently', () => {
  assert.deepEqual(selectRoutes(ROUTES, 'HOME-01,HOEM-01,adm-01'), { selected: [ROUTES[0]], unknown: ['HOEM-01', 'adm-01'] });
  assert.deepEqual(selectRoutes(ROUTES, 'NOPE-1'), { selected: [], unknown: ['NOPE-1'] });
});
