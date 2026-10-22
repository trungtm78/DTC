import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProgress } from '../src/progress.mjs';
import { checkUatCoverage } from '../src/uat.mjs';
import { checkCommitSubjects } from '../src/commits.mjs';

const SECTIONS = [
  '## Đã hoàn thành',
  '## Đang làm dở',
  '## Hàng đợi task kế tiếp (M1)',
  '## Quyết định kiến trúc',
  '## Assumption đã tự quyết',
  '## Trạng thái test',
  '## Nợ kỹ thuật / rủi ro',
];

function progress({ status = 'IN_PROGRESS', sections = SECTIONS, extra = '', next = true } = {}) {
  return [
    `STATUS: ${status}`,
    '',
    '# PROGRESS',
    'Cập nhật: 2026-10-22 | Milestone: M1/6 | Task: 1/14',
    ...sections.flatMap((heading) => [heading, 'content', '']),
    next ? 'BƯỚC TIẾP THEO: run the checker' : 'BƯỚC TIẾP THEO:',
    extra,
  ].join('\n');
}

const codes = (findings) => findings.map((f) => f.code).sort();

test('a complete in-progress file passes', () => {
  assert.deepEqual(checkProgress(progress(), { uatAllPass: false }), []);
});

test('the first line must be a known STATUS sentinel', () => {
  assert.deepEqual(codes(checkProgress('# PROGRESS\nCập nhật: x', {})).includes('PROGRESS_STATUS_INVALID'), true);
  assert.ok(codes(checkProgress(progress().replace('STATUS: IN_PROGRESS', 'STATUS: DONE'), {})).includes('PROGRESS_STATUS_INVALID'));
});

test('every section from the section 7 template is required', () => {
  const findings = checkProgress(progress({ sections: SECTIONS.slice(2) }), {});
  assert.deepEqual(codes(findings), ['PROGRESS_SECTION_MISSING', 'PROGRESS_SECTION_MISSING']);
  assert.deepEqual(findings[0].params, { section: '## Đã hoàn thành' });
});

test('an in-progress file must say what to do next', () => {
  assert.deepEqual(codes(checkProgress(progress({ next: false }), {})), ['PROGRESS_NEXT_STEP_MISSING']);
});

test('ALL_MILESTONES_DONE requires a fully passing UAT matrix', () => {
  assert.deepEqual(codes(checkProgress(progress({ status: 'ALL_MILESTONES_DONE' }), { uatAllPass: false })), ['PROGRESS_DONE_WITHOUT_UAT']);
  assert.deepEqual(checkProgress(progress({ status: 'ALL_MILESTONES_DONE', next: false }), { uatAllPass: true }), []);
});

test('BLOCKED requires the four-part blocker report', () => {
  const incomplete = progress({ status: 'BLOCKED', extra: '## Blocker\n1. problem\n2. attempts' });
  assert.deepEqual(codes(checkProgress(incomplete, {})), ['PROGRESS_BLOCKER_REPORT_INCOMPLETE']);
  const complete = progress({ status: 'BLOCKED', extra: '## Blocker\n1. a\n2. b\n3. c\n4. one closed question?' });
  assert.deepEqual(checkProgress(complete, {}), []);
  assert.deepEqual(codes(checkProgress(progress({ status: 'BLOCKED' }), {})), ['PROGRESS_BLOCKER_REPORT_INCOMPLETE']);
});

const UAT_HEADER = '| ID | Màn hình/Chức năng | Viết test | Chạy test | Kết quả |\n|---|---|---|---|---|';

test('UAT matrix: every row must be PASS and the matrix must not be empty', () => {
  const pass = `${UAT_HEADER}\n| UAT-1 | Login | yes | yes | PASS |\n| UAT-2 | Report | yes | yes | PASS |`;
  assert.deepEqual(checkUatCoverage(pass), { allPass: true, findings: [] });

  const mixed = `${UAT_HEADER}\n| UAT-1 | Login | yes | yes | PASS |\n| UAT-2 | Report | yes | no | NOT_RUN |\n| UAT-3 | Pay | yes | yes | FAIL |`;
  const result = checkUatCoverage(mixed);
  assert.equal(result.allPass, false);
  assert.deepEqual(codes(result.findings), ['UAT_ROW_NOT_PASS', 'UAT_ROW_NOT_PASS']);

  assert.deepEqual(codes(checkUatCoverage(UAT_HEADER).findings), ['UAT_MATRIX_EMPTY']);
  assert.deepEqual(codes(checkUatCoverage(undefined).findings), ['UAT_MATRIX_MISSING']);
});

test('commit subjects must be English conventional commits', () => {
  assert.deepEqual(checkCommitSubjects(['feat(tools): add checker', 'fix: handle empty input', 'chore!: drop node 20']), []);
  const findings = checkCommitSubjects(['Update stuff', 'feat: thêm kiểm tra', `fix: ${'x'.repeat(120)}`]);
  assert.deepEqual(codes(findings), ['COMMIT_NOT_CONVENTIONAL', 'COMMIT_NOT_ENGLISH', 'COMMIT_SUBJECT_TOO_LONG']);
});
