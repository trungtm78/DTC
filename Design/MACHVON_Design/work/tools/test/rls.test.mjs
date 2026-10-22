import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalPolicies } from '../src/sql.mjs';
import { normalizeRls, RLS_MODULE } from '../src/rls.mjs';
import { checkRlsConvention } from '../src/checks/rls.mjs';
import { mergeFragments } from '../src/merge.mjs';
import { validModel } from './fixtures.mjs';

const PREDICATE = "tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid";
const table = (name, extra = '') => `CREATE TABLE ${name} (\n  tenant_id uuid NOT NULL,\n  id uuid NOT NULL${extra}\n);`;

test('finalPolicies replays create and drop statements in order', () => {
  const sql = [
    table('project'),
    `CREATE POLICY tenant_boundary ON project USING (${PREDICATE});`,
    `CREATE POLICY tenant_guard ON project AS RESTRICTIVE USING (${PREDICATE});`,
    'DROP POLICY IF EXISTS tenant_guard ON project;',
    `CREATE POLICY extra_guard ON project AS RESTRICTIVE USING (true);`,
  ].join('\n');
  assert.deepEqual(finalPolicies(sql).get('project'), [
    { name: 'tenant_boundary', kind: 'PERMISSIVE' },
    { name: 'extra_guard', kind: 'RESTRICTIVE' },
  ]);
});

test('a table following the convention yields no findings; a baseline-style one does', () => {
  const good = [
    table('a'),
    `CREATE POLICY tenant_boundary ON a AS RESTRICTIVE USING (${PREDICATE});`,
    `CREATE POLICY tenant_access ON a AS PERMISSIVE USING (${PREDICATE});`,
  ].join('\n');
  assert.deepEqual(checkRlsConvention({ sql: good }), []);

  const baseline = [table('b'), `CREATE POLICY tenant_boundary ON b USING (${PREDICATE});`].join('\n');
  const findings = checkRlsConvention({ sql: baseline });
  assert.deepEqual(findings.map((f) => f.code), ['RLS_POLICY_CONVENTION']);
  assert.deepEqual(findings[0].params, { table: 'b' });
});

test('tables without tenant_id and extra scope policies are left alone', () => {
  const sql = [
    'CREATE TABLE tenant (\n  id uuid NOT NULL\n);',
    table('c'),
    `CREATE POLICY tenant_boundary ON c AS RESTRICTIVE USING (${PREDICATE});`,
    `CREATE POLICY tenant_access ON c AS PERMISSIVE USING (${PREDICATE});`,
    'CREATE POLICY scope_units_guard ON c AS RESTRICTIVE USING (true);',
  ].join('\n');
  assert.deepEqual(checkRlsConvention({ sql }), []);
  assert.equal(normalizeRls(sql), sql, 'nothing to normalise');
});

test('normalizeRls converts baseline and tenant_guard policies and keeps other policies', () => {
  const sql = [
    table('a'),
    `CREATE POLICY tenant_boundary ON a USING (${PREDICATE}) WITH CHECK (${PREDICATE});`,
    table('b'),
    `CREATE POLICY tenant_boundary ON b USING (${PREDICATE});`,
    `CREATE POLICY tenant_guard ON b AS RESTRICTIVE USING (${PREDICATE});`,
    `CREATE POLICY outbox_relay_access ON b USING (true);`,
  ].join('\n');
  const normalised = normalizeRls(sql);
  assert.match(normalised, new RegExp(`-- BEGIN module ${RLS_MODULE}`));
  assert.deepEqual(checkRlsConvention({ sql: normalised }), []);
  const policies = finalPolicies(normalised).get('b').map((p) => `${p.name}/${p.kind}`).sort();
  assert.deepEqual(policies, ['outbox_relay_access/PERMISSIVE', 'tenant_access/PERMISSIVE', 'tenant_boundary/RESTRICTIVE']);
  assert.match(normalised, /ALTER TABLE a ENABLE ROW LEVEL SECURITY;/);
  assert.match(normalised, /ALTER TABLE a FORCE ROW LEVEL SECURITY;/);
});

test('normalizeRls is idempotent and replaces its own previous section', () => {
  const sql = [table('a'), `CREATE POLICY tenant_boundary ON a USING (${PREDICATE});`].join('\n');
  const once = normalizeRls(sql);
  assert.equal(normalizeRls(once), once);
  const withLaterTable = `${once}\n${table('z')}`;
  const again = normalizeRls(withLaterTable);
  assert.equal((again.match(new RegExp(`-- BEGIN module ${RLS_MODULE}`, 'g')) ?? []).length, 1);
  assert.ok(again.trimEnd().endsWith(`-- END module ${RLS_MODULE}`), 'the section stays last so later tables are covered');
  assert.deepEqual(checkRlsConvention({ sql: again }), []);
});

test('mergeFragments normalises RLS after every fragment is applied', () => {
  const model = validModel();
  const base = {
    screens: model.screens, backlog: model.backlog, trace: model.trace, tests: model.tests,
    nonFunctional: [], decisions: [], openapi: { paths: {}, components: { schemas: {} } },
    dictionary: { entities: {} }, sql: '',
  };
  const { sources } = mergeFragments(base, [
    { module: 'A', sql: `${table('late')}\nCREATE POLICY tenant_boundary ON late USING (${PREDICATE});` },
  ]);
  assert.deepEqual(checkRlsConvention({ sql: sources.sql }), []);
});
