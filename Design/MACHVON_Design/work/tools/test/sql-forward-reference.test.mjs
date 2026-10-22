import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSqlForwardReference } from '../src/checks/sql-forward-reference.mjs';
import { runChecks } from '../src/checks/index.mjs';
import { validModel } from './fixtures.mjs';

const create = (name, extra = '') => `CREATE TABLE ${name} (\n  id uuid NOT NULL${extra}\n);`;

test('references to tables created earlier produce no findings', () => {
  const sql = [create('a'), create('b', ',\n  a_id uuid REFERENCES a(id)'), 'ALTER TABLE a ADD FOREIGN KEY (id) REFERENCES b(id);'].join('\n');
  assert.deepEqual(checkSqlForwardReference({ sql }), []);
});

test('a standalone foreign key placed before its target table is reported', () => {
  const sql = [create('a'), 'ALTER TABLE a ADD FOREIGN KEY (id) REFERENCES late(id);', create('late')].join('\n');
  const findings = checkSqlForwardReference({ sql });
  assert.deepEqual(findings.map((item) => item.code), ['SQL_FORWARD_REFERENCE']);
  assert.deepEqual(findings[0].params, { table: 'a', target: 'late' });
  assert.equal(findings[0].severity, 'error');
});

test('an inline column reference to a later table is reported against its own table', () => {
  const sql = [create('a', ',\n  b_id uuid REFERENCES b(id)'), create('b')].join('\n');
  assert.deepEqual(checkSqlForwardReference({ sql }).map((item) => item.params), [{ table: 'a', target: 'b' }]);
});

test('a self reference is not a forward reference', () => {
  const sql = create('a', ',\n  parent_id uuid REFERENCES a(id)');
  assert.deepEqual(checkSqlForwardReference({ sql }), []);
});

test('targets that are not defined in the file are ignored and comments are skipped', () => {
  const sql = [create('a'), 'ALTER TABLE a ADD FOREIGN KEY (id) REFERENCES external_table(id);', '-- ALTER TABLE a ADD FOREIGN KEY (id) REFERENCES late(id);', create('late')].join('\n');
  assert.deepEqual(checkSqlForwardReference({ sql }), []);
});

test('the same offending pair is reported once per statement', () => {
  const sql = [
    create('a'),
    'ALTER TABLE a ADD FOREIGN KEY (id) REFERENCES late(id);',
    'ALTER TABLE a ADD FOREIGN KEY (id) REFERENCES late(id);',
    create('late'),
  ].join('\n');
  assert.equal(checkSqlForwardReference({ sql }).length, 2);
});

test('the check is part of the standard run', () => {
  const model = validModel();
  model.sql += '\nALTER TABLE tenant ADD FOREIGN KEY (id) REFERENCES missing_later(id);\nCREATE TABLE missing_later (\n  id uuid NOT NULL\n);';
  assert.ok(runChecks(model).some((item) => item.code === 'SQL_FORWARD_REFERENCE'));
});
