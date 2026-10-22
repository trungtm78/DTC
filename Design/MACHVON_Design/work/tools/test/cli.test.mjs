import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModel, ENGINEERING_FILES } from '../src/model.mjs';
import { translate, loadMessages } from '../src/i18n.mjs';
import { formatReport, main } from '../src/check-cli.mjs';
import { validModel } from './fixtures.mjs';

function writeEngineeringDir(model, { withNonFunctional = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-check-'));
  const write = (name, value) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  write(ENGINEERING_FILES.screens, model.screens);
  write(ENGINEERING_FILES.backlog, model.backlog);
  write(ENGINEERING_FILES.trace, model.trace);
  write(ENGINEERING_FILES.tests, model.tests);
  write(ENGINEERING_FILES.openapi, model.openapi);
  write(ENGINEERING_FILES.dictionary, { version: 'test', entities: model.entities });
  write(ENGINEERING_FILES.sql, model.sql);
  if (withNonFunctional) write(ENGINEERING_FILES.nonFunctional, model.nonFunctional);
  return dir;
}

test('loadModel reads every engineering source into the check model', () => {
  const dir = writeEngineeringDir(validModel());
  const model = loadModel(dir);
  assert.deepEqual(model.screens, validModel().screens);
  assert.deepEqual(model.entities, validModel().entities);
  assert.equal(model.sql, validModel().sql);
  assert.deepEqual(model.nonFunctional, validModel().nonFunctional);
});

test('loadModel treats a missing non-functional register as empty', () => {
  const dir = writeEngineeringDir(validModel(), { withNonFunctional: false });
  assert.deepEqual(loadModel(dir).nonFunctional, []);
});

test('translate fills placeholders and falls back to the key when unknown', () => {
  const messages = { 'a.b': 'Test {id} in {from}' };
  assert.equal(translate(messages, 'a.b', { id: 'T1', from: 'FR-1' }), 'Test T1 in FR-1');
  assert.equal(translate(messages, 'missing.key', {}), 'missing.key');
});

test('every finding code has a message in each locale', () => {
  for (const locale of ['en', 'vi']) {
    const messages = loadMessages(locale);
    for (const key of [
      'check.finding.duplicateId',
      'check.finding.orphanTest',
      'check.finding.writeWithoutIdempotency',
      'check.finding.fkColumnWithoutIndex',
      'check.report.summary',
      'check.report.clean',
    ]) {
      assert.ok(messages[key], `${locale} misses ${key}`);
    }
  }
});

test('formatReport groups findings by code with a summary line', () => {
  const messages = loadMessages('en');
  const findings = [
    { code: 'ORPHAN_TEST', severity: 'error', messageKey: 'check.finding.orphanTest', params: { id: 'T1' } },
    { code: 'ORPHAN_TEST', severity: 'error', messageKey: 'check.finding.orphanTest', params: { id: 'T2' } },
  ];
  const report = formatReport(findings, messages, { limitPerCode: 1 });
  assert.match(report, /ORPHAN_TEST \(2\)/);
  assert.match(report, /T1/);
  assert.doesNotMatch(report, /T2/);
  assert.match(report, /2 error/);
});

test('formatReport prints the clean message when nothing is found', () => {
  const messages = loadMessages('en');
  assert.equal(formatReport([], messages), messages['check.report.clean']);
});

test('main returns exit code 1 with findings and 0 when clean', () => {
  const output = [];
  const log = (line) => output.push(line);
  const clean = writeEngineeringDir(validModel());
  assert.equal(main(['--dir', clean, '--locale', 'en'], log), 0);

  const broken = validModel();
  broken.tests.push({ id: 'UAT-AC96', priority: 'P1', steps: ['x'], expected: 'y' });
  assert.equal(main(['--dir', writeEngineeringDir(broken), '--json'], log), 1);
  assert.equal(JSON.parse(output.at(-1))[0].code, 'ORPHAN_TEST');
});
