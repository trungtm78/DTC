import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffRecords, flattenDictionary, matchesPattern, buildChangeLog, checkBaseline, removedParagraphs } from '../src/baseline.mjs';
import { baselineMain } from '../src/baseline-cli.mjs';

const codes = (findings) => findings.map((f) => f.code).sort();
const key = (r) => r.id;

test('diffRecords separates lost records from changed ones and ignores additions', () => {
  const baseline = [{ id: 'A', v: 1 }, { id: 'B', v: 2 }, { id: 'C', v: 3 }];
  const current = [{ id: 'A', v: 1 }, { id: 'B', v: 9, extra: true }, { id: 'D', v: 4 }];
  const result = diffRecords(baseline, current, key);
  assert.deepEqual(result.lost, ['C']);
  assert.deepEqual(result.changed, [{ key: 'B', fields: ['extra', 'v'] }]);
});

test('flattenDictionary turns entities into table.column records', () => {
  const flat = flattenDictionary({ project: { id: 'uuid PK', name: 'text' }, tenant: { id: 'uuid' } });
  assert.deepEqual(flat.map((r) => r.id).sort(), ['project.id', 'project.name', 'tenant.id']);
  assert.equal(flat.find((r) => r.id === 'project.name').type, 'text');
});

test('matchesPattern supports a trailing or inner star wildcard', () => {
  assert.equal(matchesPattern('project.status', 'project.*'), true);
  assert.equal(matchesPattern('PRJ-01', 'PRJ-*'), true);
  assert.equal(matchesPattern('CAP-01', 'PRJ-*'), false);
  assert.equal(matchesPattern('exact', 'exact'), true);
});

test('changed baseline records get a CR from the register or stay unassigned', () => {
  const diffs = { dictionary: { lost: [], changed: [{ key: 'project.status', fields: ['type'] }, { key: 'tenant.code', fields: ['type'] }] } };
  const register = [{ collection: 'dictionary', match: 'project.*', cr: 'CR-PRJ-01', reason: 'PIMA lifecycle' }];
  const log = buildChangeLog(diffs, register);
  assert.deepEqual(log.map((e) => [e.key, e.cr]), [['project.status', 'CR-PRJ-01'], ['tenant.code', null]]);
  assert.equal(log[0].reason, 'PIMA lifecycle');
});

test('lost records and changes without a CR are errors; covered changes are not', () => {
  const diffs = {
    screens: { lost: ['IAM-99'], changed: [{ key: 'IAM-01', fields: ['role'] }] },
    dictionary: { lost: ['project.old_col'], changed: [] },
  };
  const findings = checkBaseline(diffs, buildChangeLog(diffs, []));
  assert.deepEqual(codes(findings), ['BASELINE_CHANGE_WITHOUT_CR', 'BASELINE_COLUMN_LOST', 'BASELINE_ID_LOST']);

  const covered = checkBaseline({ screens: { lost: [], changed: [{ key: 'IAM-01', fields: ['role'] }] } },
    buildChangeLog({ screens: { lost: [], changed: [{ key: 'IAM-01', fields: ['role'] }] } }, [{ collection: 'screens', match: 'IAM-*', cr: 'CR-IAM-01' }]));
  assert.deepEqual(covered, []);
});

test('removedParagraphs finds baseline paragraphs absent from the current text', () => {
  const baseline = 'Đoạn một giữ nguyên và đủ dài để được tính là một đoạn văn bản thực sự của tài liệu.\n\nĐoạn hai bị xóa khỏi tài liệu mới và cũng đủ dài để được tính là một đoạn.';
  const current = 'Đoạn một giữ nguyên và đủ dài để được tính là một đoạn văn bản thực sự của tài liệu.\n\nĐoạn mới.';
  assert.equal(removedParagraphs(baseline, current).length, 1);
  assert.match(removedParagraphs(baseline, current)[0], /Đoạn hai/);
});

test('a removed paragraph is accepted only when the mapping appendix quotes its opening', () => {
  const baseline = 'Đoạn hai bị xóa khỏi tài liệu mới và cũng đủ dài để được tính là một đoạn văn bản thực sự.';
  const unmapped = removedParagraphs(baseline, 'Nội dung khác hoàn toàn.');
  assert.equal(unmapped.length, 1);
  const appendix = '## Phụ lục: ánh xạ nội dung baseline 1.3\n- "Đoạn hai bị xóa khỏi tài liệu mới" → mục 4.';
  assert.deepEqual(removedParagraphs(baseline, `Nội dung khác.\n\n${appendix}`), []);
});

function repoWithBaseline() {
  const root = mkdtempSync(join(tmpdir(), 'machvon-base-'));
  const base = join(root, 'base');
  const eng = join(root, 'eng');
  const docs = join(root, 'docs');
  [base, eng, docs].forEach((d) => mkdirSync(d));
  const w = (d, name, value) => writeFileSync(join(d, name), typeof value === 'string' ? value : JSON.stringify(value));
  const files = (d, screens) => {
    w(d, 'screen_catalog.json', screens);
    w(d, 'implementation_backlog.json', [{ id: 'BL-1', screen: 'S-1' }]);
    w(d, 'traceability.json', [{ requirement: 'FR-1', screen: 'S-1' }]);
    w(d, 'test_cases.json', [{ id: 'T1' }]);
    w(d, 'implementation_decisions.json', [{ id: 'D01' }]);
    w(d, 'openapi.json', { paths: { '/a': { get: { operationId: 'getA' } } } });
    w(d, 'data_dictionary.json', { entities: { project: { id: 'uuid' } } });
    w(d, 'schema_reference.sql', 'CREATE TABLE project (\n id uuid\n);');
  };
  files(base, [{ id: 'S-1', role: 'Cán bộ' }]);
  files(eng, [{ id: 'S-1', role: 'Officer' }, { id: 'S-2', role: 'New' }]);
  return { root, base, eng, docs };
}

test('the CLI writes the change log, fails on an unassigned change and passes once a CR covers it', () => {
  const { root, base, eng, docs } = repoWithBaseline();
  const log = [];
  const args = ['--baseline-dir', base, '--dir', eng, '--docs', docs, '--locale', 'en'];
  assert.equal(baselineMain(args, (l) => log.push(l)), 1);
  const changeLog = JSON.parse(readFileSync(join(eng, 'change_log.json'), 'utf8'));
  assert.deepEqual(changeLog.map((e) => [e.collection, e.key, e.cr]), [['screens', 'S-1', null]]);

  writeFileSync(join(eng, 'baseline_change_register.json'), JSON.stringify([{ collection: 'screens', match: 'S-*', cr: 'CR-ROLE-01', reason: 'canonical role names' }]));
  assert.equal(baselineMain(args, () => {}), 0);
  assert.equal(JSON.parse(readFileSync(join(eng, 'change_log.json'), 'utf8'))[0].cr, 'CR-ROLE-01');
  assert.ok(root);
});

test('a paragraph edited in place keeps its opening and is not reported as removed', () => {
  const opening = 'Đoạn này được sửa tại chỗ nên phần mở đầu của nó vẫn còn nguyên trong tài liệu mới';
  const baseline = `${opening} và phần cuối cũ sẽ bị thay.`;
  const current = `${opening} và phần cuối mới đã thay thế (Cập nhật 1.4 — CR-X-01).`;
  assert.deepEqual(removedParagraphs(baseline, current), []);
});

test('--only docs lists every unmapped baseline paragraph and ignores record changes', () => {
  const { base, eng, docs } = repoWithBaseline();
  const baseDocs = join(base, 'docs');
  mkdirSync(baseDocs);
  writeFileSync(join(baseDocs, '01_A.md'), 'Đoạn gốc này đủ dài để được tính là một đoạn văn bản thực sự của tài liệu baseline.');
  writeFileSync(join(docs, '01_A.md'), 'Nội dung hoàn toàn khác không còn đoạn gốc nào cả.');
  const log = [];
  const code = baselineMain(['--baseline-dir', base, '--baseline-docs', baseDocs, '--dir', eng, '--docs', docs, '--only', 'docs', '--locale', 'en'], (l) => log.push(l));
  assert.equal(code, 1);
  assert.ok(log.some((line) => /01_A\.md/.test(line)));
  assert.ok(!log.some((line) => /screens\/S-1/.test(line)));
});
