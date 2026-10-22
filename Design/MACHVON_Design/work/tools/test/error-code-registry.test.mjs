import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { humanize, indexSpecMentions, main, mergeRegistry, proposeEntries } from '../src/error-code-registry.mjs';
import { ENGINEERING_FILES } from '../src/model.mjs';
import { loadMessages } from '../src/i18n.mjs';
import { validModel } from './fixtures.mjs';

const SPEC = [
  '- **BR-CAP-06** allocated = 0 → chặn (`AVC_BLOCKED`, lý do ZERO_ALLOCATION). Hết hạn thì thả.',
  '| operationId | Method path | Lỗi |',
  '|---|---|---|',
  '| `createReservation` / `releaseReservation` | POST /reservations | q | `Dto` | 422 AVC_BLOCKED; 409 RESERVATION_NOT_ACTIVE; SOFT_FAIL | ✔ |',
  '| Từ | Command | Đến | Guard LOCKED_GUARD |',
  '| UAT-AC1 | integration | P0 | 409 UAT_ONLY_CODE |',
].join('\n');

test('humanize turns a code into a short sentence', () => {
  assert.equal(humanize('AVC_WARNING_ACK_REQUIRED'), 'Avc warning ack required');
});

test('spec mentions record the module, kind, nearest status and describing text', () => {
  const index = indexSpecMentions({ CAP: SPEC });
  const [prose] = index.get('AVC_BLOCKED');
  assert.deepEqual([prose.module, prose.kind, prose.status], ['CAP', 'prose', null]);
  assert.match(prose.text, /allocated = 0/);
  const api = index.get('AVC_BLOCKED')[1];
  assert.deepEqual([api.kind, api.status, api.text], ['api', 422, 'Raised by createReservation / releaseReservation (POST /reservations)']);
  assert.equal(index.get('RESERVATION_NOT_ACTIVE')[0].status, 409);
  assert.equal(index.get('SOFT_FAIL')[0].status, 409);
  assert.equal(index.get('LOCKED_GUARD')[0].kind, 'table');
  assert.equal(index.has('UAT_ONLY_CODE'), false);
  assert.equal(indexSpecMentions(undefined).size, 0);
});

test('a status earlier in the same sentence is the nearest status of a prose code', () => {
  const index = indexSpecMentions({ X: 'Trước đó 200 ok. Sai → 403 `A_DENIED`, còn B_DENIED cũng vậy.' });
  assert.equal(index.get('A_DENIED')[0].status, 403);
  assert.equal(index.get('B_DENIED')[0].status, 403);
});

function entry(code, status, where, extra = {}) {
  return { code, status, where, text: `${status} ${code}`, ...extra };
}

test('the status comes from the first source that states one, specs before OpenAPI, plan and tests', () => {
  const sources = {
    specs: [entry('CODE_A', 409, 'PAY'), entry('CODE_A', 409, 'PAY'), entry('CODE_A', 422, 'PAY')],
    openapi: [entry('CODE_A', 422, 'openapi'), entry('CODE_B', 401, 'openapi'), { code: 'CODE_C', status: null, where: 'op', text: '', tag: 'PAY' }],
    basicDesign: [entry('CODE_D', 503, 'basicDesign')],
    plan: [entry('CODE_E', 429, 'ST-1')],
    tests: [entry('CODE_F', 400, 'T-1')],
  };
  const codes = ['CODE_A', 'CODE_B', 'CODE_D', 'CODE_E', 'CODE_F'];
  const result = proposeEntries(sources, new Map(), codes);
  assert.deepEqual(codes.map((c) => [result[c].status, result[c].statusBasis]), [
    [409, 'spec'],
    [401, 'openapi'],
    [503, 'basic-design'],
    [429, 'plan'],
    [400, 'test'],
  ]);
  assert.deepEqual(result.CODE_A.otherStatuses, [422]);
  assert.equal('otherStatuses' in result.CODE_B, false);
});

test('without a stated status the nearest status in the spec, then a suffix convention, then 422 applies', () => {
  const sources = {
    specs: [entry('A_STATE_INVALID', 409, 'X'), entry('B_STATE_INVALID', 409, 'X'), entry('C_STATE_INVALID', 409, 'X'), entry('A_NOT_FOUND', 404, 'X')],
    openapi: ['NEW_STATE_INVALID', 'NEARBY_CODE', 'ODD_THING', 'LONELY_NOT_FOUND'].map((code) => ({ code, status: null, where: 'op', text: 'summary', tag: 'X' })),
  };
  const mentions = new Map([['NEARBY_CODE', [{ module: 'X', kind: 'prose', status: 403, text: 'ctx' }]]]);
  const result = proposeEntries(sources, mentions, ['NEW_STATE_INVALID', 'NEARBY_CODE', 'ODD_THING', 'LONELY_NOT_FOUND', 'A_STATE_INVALID']);
  assert.deepEqual(
    ['NEW_STATE_INVALID', 'NEARBY_CODE', 'ODD_THING', 'LONELY_NOT_FOUND'].map((c) => [result[c].status, result[c].statusBasis]),
    [[409, 'convention'], [403, 'spec-nearby'], [422, 'default'], [422, 'default']],
  );
  assert.equal(result.A_STATE_INVALID.statusBasis, 'spec');
});

test('a split suffix vote falls back to the default status', () => {
  const sources = {
    specs: [entry('A_FAILED', 409, 'X'), entry('B_FAILED', 422, 'X')],
    openapi: [{ code: 'C_FAILED', status: null, where: 'op', text: '', tag: 'X' }],
  };
  assert.equal(proposeEntries(sources, new Map(), ['C_FAILED']).C_FAILED.statusBasis, 'default');
});

function mention(module, kind, text) {
  return { module, kind, status: null, text };
}

test('the owner is the module that names the code most, KERNEL when three or more modules share it', () => {
  const sources = { openapi: [{ code: 'TAGGED', status: null, where: 'op', text: 'sum', tag: 'IAM' }], plan: [entry('PLANNED', 422, 'ST', { module: 'LND' })], tests: [entry('LOOSE', 422, 'T')] };
  const mentions = new Map([
    ['SHARED', [mention('A', 'prose', 'x'), mention('B', 'prose', 'x'), mention('C', 'prose', 'x')]],
    ['MAJOR', [mention('B', 'prose', 'x'), mention('A', 'prose', 'x'), mention('A', 'api', 'y')]],
  ]);
  const result = proposeEntries(
    { ...sources, specs: [] },
    mentions,
    ['SHARED', 'MAJOR', 'TAGGED', 'PLANNED', 'LOOSE'],
  );
  assert.deepEqual(['SHARED', 'MAJOR', 'TAGGED', 'PLANNED', 'LOOSE'].map((c) => result[c].module), ['KERNEL', 'A', 'IAM', 'LND', 'KERNEL']);
  const wide = { openapi: ['A', 'B', 'C'].map((tag) => ({ code: 'WIDE', status: null, where: 'op', text: 's', tag })) };
  assert.equal(proposeEntries(wide, new Map(), ['WIDE']).WIDE.module, 'KERNEL');
});

test('the meaning is the spec text: prose first, then the API row, any table, OpenAPI summary or acceptance text', () => {
  const mentions = new Map([
    ['PROSE_CODE', [mention('A', 'api', 'Raised by op'), mention('A', 'prose', 'The prose statement.')]],
    ['API_CODE', [mention('A', 'api', 'Raised by op (POST /x)')]],
    ['TABLE_CODE', [mention('A', 'table', 'Từ | Đến')]],
    ['OTHER_MODULE_PROSE', [mention('B', 'prose', 'Defined elsewhere.'), mention('A', 'api', 'Raised')]],
  ]);
  const sources = {
    openapi: [{ code: 'DECLARED', status: null, where: 'doOp', text: 'Does the thing', tag: 'A' }, entry('FROM_DESC', 409, 'openapi')],
    plan: [entry('PLAN_ONLY', 422, 'ST-1', { text: 'first clause; the call returns 422 PLAN_ONLY here. Last.' })],
  };
  const result = proposeEntries(sources, mentions, ['PROSE_CODE', 'API_CODE', 'TABLE_CODE', 'OTHER_MODULE_PROSE', 'DECLARED', 'FROM_DESC', 'PLAN_ONLY', 'NO_TEXT']);
  const text = (code) => [result[code].meaning, result[code].source];
  assert.deepEqual(text('PROSE_CODE'), ['The prose statement.', 'spec:A']);
  assert.deepEqual(text('API_CODE'), ['Raised by op (POST /x)', 'spec:A']);
  assert.deepEqual(text('TABLE_CODE'), ['Từ | Đến', 'spec:A']);
  assert.deepEqual(text('OTHER_MODULE_PROSE'), ['Defined elsewhere.', 'spec:B']);
  assert.deepEqual(text('DECLARED'), ['Declared by operation doOp: Does the thing', 'openapi']);
  assert.deepEqual(text('FROM_DESC'), ['409 FROM_DESC', 'text']);
  assert.deepEqual(text('PLAN_ONLY'), ['the call returns 422 PLAN_ONLY here.', 'text']);
  assert.deepEqual(text('NO_TEXT'), ['No text', 'code']);
});

test('a long statement is cut to a window around the code', () => {
  const long = `${'lead '.repeat(60)}CODE_X ${'tail '.repeat(60)}`.trim();
  const mentions = new Map([['CODE_X', [mention('A', 'prose', long)]], ['CODE_Y', [mention('A', 'prose', `CODE_Y ${'tail '.repeat(80)}`.trim())]]]);
  const result = proposeEntries({}, mentions, ['CODE_X', 'CODE_Y']);
  assert.ok(result.CODE_X.meaning.startsWith('…') && result.CODE_X.meaning.endsWith('…'));
  assert.ok(result.CODE_X.meaning.includes('CODE_X'));
  assert.ok(result.CODE_X.meaning.length <= 222);
  assert.ok(!result.CODE_Y.meaning.startsWith('…') && result.CODE_Y.meaning.endsWith('…'));
});

test('mergeRegistry only adds: canonical, aliases, excluded and existing entries stay as they are', () => {
  const current = {
    note: 'n',
    canonical: { OLD_ONE: 'x' },
    aliases: { OLD_ALIAS: 'OLD_ONE' },
    excluded: { SHORTHAND: 'why' },
    registry: { EXISTING: { status: 409 } },
  };
  const merged = mergeRegistry(current, { ZED: { status: 422 }, ALPHA: { status: 400 }, OLD_ONE: { status: 500 }, EXISTING: { status: 500 } });
  assert.deepEqual(Object.keys(merged.registry), ['ALPHA', 'EXISTING', 'ZED']);
  assert.deepEqual(merged.registry.EXISTING, { status: 409 });
  assert.deepEqual({ ...merged, registry: undefined }, { ...current, registry: undefined });
  assert.deepEqual(Object.keys(mergeRegistry({ canonical: {} }, { A_B: {} }).registry), ['A_B']);
});

function writePackage() {
  const root = mkdtempSync(join(tmpdir(), 'machvon-registry-'));
  const dir = join(root, 'eng');
  const docs = join(root, 'docs');
  mkdirSync(dir);
  mkdirSync(join(docs, '05_modules'), { recursive: true });
  const model = validModel();
  model.openapi.paths['/reports/{id}/submit'].post['x-error-codes'] = ['PERIOD_LOCKED', 'NEW_ONE', 'SHORTHAND'];
  const write = (name, value) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  write(ENGINEERING_FILES.screens, model.screens);
  write(ENGINEERING_FILES.backlog, model.backlog);
  write(ENGINEERING_FILES.trace, model.trace);
  write(ENGINEERING_FILES.tests, model.tests);
  write(ENGINEERING_FILES.openapi, model.openapi);
  write(ENGINEERING_FILES.dictionary, { version: 'test', entities: model.entities });
  write(ENGINEERING_FILES.sql, model.sql);
  write(ENGINEERING_FILES.errorCodes, { canonical: { PERIOD_LOCKED: 'locked (422).' }, aliases: {}, excluded: { SHORTHAND: 'not a code' } });
  writeFileSync(join(docs, '05_modules', 'DIS.md'), '- Sai → 409 `NEW_ONE`.');
  return { dir, docs };
}

test('main prints the proposal without writing, and --write adds the registry to error_codes.json', () => {
  const { dir, docs } = writePackage();
  const lines = [];
  const log = (line) => lines.push(line);
  assert.equal(main(['--dir', dir, '--docs', docs], log), 0);
  const proposal = JSON.parse(lines.at(-1));
  assert.deepEqual(Object.keys(proposal), ['NEW_ONE']);
  assert.equal(proposal.NEW_ONE.status, 409);
  const path = join(dir, ENGINEERING_FILES.errorCodes);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).registry, undefined);

  assert.equal(main(['--dir', dir, '--docs', docs, '--write', '--locale', 'en'], log), 0);
  assert.equal(lines.at(-1), loadMessages('en')['registry.written'].replace('{count}', '1'));
  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(written.registry), ['NEW_ONE']);
  assert.deepEqual(written.excluded, { SHORTHAND: 'not a code' });
  assert.deepEqual(written.canonical, { PERIOD_LOCKED: 'locked (422).' });
});
