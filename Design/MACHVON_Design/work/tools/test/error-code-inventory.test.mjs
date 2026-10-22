import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildInventory,
  collectSources,
  extractOpenApi,
  extractPlan,
  extractSpecs,
  extractStatusCodes,
  extractTests,
  formatInventory,
  loadInventoryModel,
  main,
  registeredCodes,
} from '../src/error-code-inventory.mjs';
import { ENGINEERING_FILES } from '../src/model.mjs';
import { loadMessages } from '../src/i18n.mjs';
import { validModel } from './fixtures.mjs';

const pairs = (entries) => entries.map(({ status, code }) => `${status} ${code}`);

test('a status followed by a code chain gives every code of the chain that status', () => {
  const text = '409 VERSION_CONFLICT/IDEMPOTENCY_CONFLICT, then 422 `AVC_BLOCKED` or ZERO_ALLOCATION | 503 PROVIDER_UNAVAILABLE';
  assert.deepEqual(pairs(extractStatusCodes(text)), [
    '409 VERSION_CONFLICT',
    '409 IDEMPOTENCY_CONFLICT',
    '422 AVC_BLOCKED',
    '422 ZERO_ALLOCATION',
    '503 PROVIDER_UNAVAILABLE',
  ]);
});

test('codes without an error status, success statuses, wildcards and plain words are not error codes', () => {
  const text = 'state SENT_TREASURY, 200 ACTIVE, 409 *_STATE_INVALID, 422 EVIDENCE_REQUIRED, DONE, PENDING_VERIFICATION and 403 Forbidden';
  assert.deepEqual(pairs(extractStatusCodes(text)), ['422 EVIDENCE_REQUIRED']);
  assert.deepEqual(extractStatusCodes(undefined), []);
});

test('an entry keeps the line that names the code and where it was found', () => {
  const [entry] = extractStatusCodes('first line\nsecond: 409 PERIOD_LOCKED here\nthird', 'DIS');
  assert.deepEqual(entry, { code: 'PERIOD_LOCKED', status: 409, where: 'DIS', text: 'second: 409 PERIOD_LOCKED here' });
});

test('OpenAPI codes come from x-error-codes lists and from status-tied descriptions', () => {
  const model = validModel();
  const operation = model.openapi.paths['/reports/{id}/submit'].post;
  operation['x-error-codes'] = ['PERIOD_LOCKED', 7];
  operation.summary = 'Submit a report';
  operation.tags = ['DIS'];
  operation.responses = { 409: { description: '409 VERSION_CONFLICT / IDEMPOTENCY_CONFLICT' } };
  const entries = extractOpenApi(model.openapi);
  assert.deepEqual(entries[0], { code: 'PERIOD_LOCKED', status: null, where: 'post_reports_id_submit', text: 'Submit a report', tag: 'DIS' });
  assert.deepEqual(pairs(entries.slice(1)), ['409 VERSION_CONFLICT', '409 IDEMPOTENCY_CONFLICT']);
  assert.deepEqual(extractOpenApi(undefined), []);
  const bare = validModel().openapi;
  bare.paths['/resources/project'].get['x-error-codes'] = ['SCOPE_DENIED'];
  assert.deepEqual(extractOpenApi(bare).map((e) => [e.text, e.tag]), [['', null]]);
});

test('plan codes come from acceptance criteria and carry the story module', () => {
  const plan = {
    stories: [
      { id: 'ST-A', module: 'CTR', acceptance: [{ then: 'returns 422 BOQ_TOTAL_MISMATCH' }, { then: 'no error code here' }] },
      { id: 'ST-B', acceptance: [{ then: '403 SELF_APPROVAL_DENIED' }] },
      { id: 'ST-C' },
    ],
  };
  assert.deepEqual(extractPlan(plan).map((e) => [e.code, e.where, e.module]), [
    ['BOQ_TOTAL_MISMATCH', 'ST-A', 'CTR'],
    ['SELF_APPROVAL_DENIED', 'ST-B', null],
  ]);
  assert.deepEqual(extractPlan(undefined), []);
});

test('spec and test codes record the module or test id they came from', () => {
  assert.deepEqual(extractSpecs({ PAY: 'Sai → 422 `ACCEPTANCE_NOT_APPROVED`.', IAM: 'none' }).map((e) => [e.code, e.where]), [
    ['ACCEPTANCE_NOT_APPROVED', 'PAY'],
  ]);
  assert.deepEqual(extractSpecs(undefined), []);
  const tests = [{ id: 'UAT-AC1', steps: ['x'], expected: 'replay; 409 IDEMPOTENCY_CONFLICT' }, { id: 'UAT-AC2' }];
  assert.deepEqual(extractTests(tests).map((e) => [e.code, e.where]), [['IDEMPOTENCY_CONFLICT', 'UAT-AC1']]);
  assert.deepEqual(extractTests(undefined), []);
});

test('collectSources gathers the five sources', () => {
  const model = { ...validModel(), moduleSpecs: { PAY: '422 PERIOD_LOCKED' }, plan: { stories: [] } };
  const sources = collectSources(model, 'Problem: 404 RESOURCE_NOT_FOUND');
  assert.deepEqual(Object.keys(sources), ['specs', 'openapi', 'basicDesign', 'plan', 'tests']);
  assert.deepEqual(sources.basicDesign.map((e) => e.code), ['RESOURCE_NOT_FOUND']);
  assert.deepEqual(collectSources(validModel()).basicDesign, []);
});

test('the registry is canonical plus structured entries and never an alias', () => {
  const errorCodes = { canonical: { A_B: 'x' }, registry: { C_D: {} }, aliases: { E_F: 'A_B' } };
  assert.deepEqual([...registeredCodes(errorCodes)].sort(), ['A_B', 'C_D']);
  assert.equal(registeredCodes(undefined).size, 0);
});

const SOURCES = {
  specs: [{ code: 'KNOWN_ONE' }, { code: 'SPEC_ONLY' }, { code: 'ACK_REQUIRED' }, { code: 'ACK_REQUIRED' }],
  openapi: [{ code: 'KNOWN_ONE' }, { code: 'OPENAPI_ONLY' }, { code: 'IN_PROGRESS' }],
  plan: [{ code: 'SPEC_ONLY' }],
  tests: [],
};
const ERROR_CODES = {
  canonical: {},
  registry: { KNOWN_ONE: {} },
  excluded: { ACK_REQUIRED: 'shorthand', IN_PROGRESS: 'state name' },
};

test('the inventory counts codes per source and lists the unregistered ones with their sources', () => {
  const inventory = buildInventory(SOURCES, ERROR_CODES);
  assert.deepEqual(inventory.counts, { specs: 3, openapi: 3, plan: 1, tests: 0 });
  assert.equal(inventory.registered, 1);
  assert.deepEqual(inventory.all, ['ACK_REQUIRED', 'IN_PROGRESS', 'KNOWN_ONE', 'OPENAPI_ONLY', 'SPEC_ONLY']);
  assert.deepEqual(inventory.missing, {
    IN_PROGRESS: ['openapi'],
    OPENAPI_ONLY: ['openapi'],
    SPEC_ONLY: ['specs', 'plan'],
  });
});

test('a documented non-code is waived only while enforced sources do not use it', () => {
  const inventory = buildInventory(SOURCES, ERROR_CODES);
  assert.deepEqual(inventory.waived, { ACK_REQUIRED: ['specs'] });
  assert.ok('IN_PROGRESS' in inventory.missing);
});

test('formatInventory prints per-source counts, missing and waived codes and a verdict', () => {
  const messages = loadMessages('en');
  const report = formatInventory(buildInventory(SOURCES, ERROR_CODES), messages);
  assert.match(report, /specs: 3/);
  assert.match(report, /SPEC_ONLY/);
  assert.match(report, /ACK_REQUIRED/);
  assert.match(report, /3 unregistered/);
  const clean = formatInventory(buildInventory({ specs: [{ code: 'KNOWN_ONE' }] }, ERROR_CODES), messages);
  assert.match(clean, new RegExp(messages['inventory.clean']));
});

function writePackage({ errorCodes, openapiCode }) {
  const root = mkdtempSync(join(tmpdir(), 'machvon-inventory-'));
  const dir = join(root, 'eng');
  const docs = join(root, 'docs');
  mkdirSync(dir);
  mkdirSync(join(docs, '05_modules'), { recursive: true });
  const model = validModel();
  model.openapi.paths['/reports/{id}/submit'].post['x-error-codes'] = [openapiCode];
  const write = (name, value) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  write(ENGINEERING_FILES.screens, model.screens);
  write(ENGINEERING_FILES.backlog, model.backlog);
  write(ENGINEERING_FILES.trace, model.trace);
  write(ENGINEERING_FILES.tests, model.tests);
  write(ENGINEERING_FILES.openapi, model.openapi);
  write(ENGINEERING_FILES.dictionary, { version: 'test', entities: model.entities });
  write(ENGINEERING_FILES.sql, model.sql);
  write(ENGINEERING_FILES.errorCodes, errorCodes);
  writeFileSync(join(docs, '05_modules', 'DIS.md'), 'Lỗi: 422 SPEC_CODE.');
  return { dir, docs };
}

test('loadInventoryModel reads the engineering sources, module specs and the basic design text', () => {
  const { dir, docs } = writePackage({ errorCodes: { canonical: {}, registry: {} }, openapiCode: 'A_CODE' });
  writeFileSync(join(docs, '04_Thiet_ke_co_ban.md'), '404 RESOURCE_NOT_FOUND');
  const { model, basicDesign } = loadInventoryModel(dir, docs);
  assert.deepEqual(Object.keys(model.moduleSpecs), ['DIS']);
  assert.equal(basicDesign, '404 RESOURCE_NOT_FOUND');
  assert.equal(loadInventoryModel(dir, join(docs, 'missing')).basicDesign, '');
});

test('main exits 1 and lists unregistered codes, and 0 once they are registered', () => {
  const lines = [];
  const log = (line) => lines.push(line);
  const open = writePackage({ errorCodes: { canonical: {}, registry: { A_CODE: {} } }, openapiCode: 'A_CODE' });
  assert.equal(main(['--dir', open.dir, '--docs', open.docs, '--locale', 'en'], log), 1);
  assert.match(lines.at(-1), /1 unregistered/);
  const done = writePackage({ errorCodes: { canonical: {}, registry: { A_CODE: {}, SPEC_CODE: {} } }, openapiCode: 'A_CODE' });
  assert.equal(main(['--dir', done.dir, '--docs', done.docs, '--locale', 'en'], log), 0);
  assert.ok(lines.at(-1).endsWith(loadMessages('en')['inventory.clean']));
  assert.equal(main(['--dir', done.dir, '--docs', done.docs, '--json'], log), 0);
  assert.deepEqual(JSON.parse(lines.at(-1)).missing, {});
});
