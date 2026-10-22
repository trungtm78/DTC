import { finding } from './finding.mjs';

// Template from AUTONOMOUS_EXECUTION_PROTOCOL.md section 7; the headings are the contract with
// the Vietnamese-language protocol document and are matched by prefix.
export const STATUSES = ['IN_PROGRESS', 'ALL_MILESTONES_DONE', 'BLOCKED'];
export const REQUIRED_SECTIONS = [
  '## Đã hoàn thành',
  '## Đang làm dở',
  '## Hàng đợi task kế tiếp',
  '## Quyết định kiến trúc',
  '## Assumption đã tự quyết',
  '## Trạng thái test',
  '## Nợ kỹ thuật / rủi ro',
];
const NEXT_STEP = /^BƯỚC TIẾP THEO:\s*\S+/m;
const BLOCKER_PARTS = [1, 2, 3, 4];

function blockerSection(lines) {
  const start = lines.findIndex((line) => /^##\s+Blocker/i.test(line));
  return start < 0 ? [] : lines.slice(start + 1);
}

export function checkProgress(text, { uatAllPass = false } = {}) {
  const lines = text.split(/\r?\n/);
  const status = lines[0].match(/^STATUS:\s*(\S+)\s*$/)?.[1];
  const findings = [];

  if (!STATUSES.includes(status)) findings.push(finding('PROGRESS_STATUS_INVALID', { first: lines[0].slice(0, 40) }));
  if (!lines.some((line) => line.startsWith('Cập nhật:'))) findings.push(finding('PROGRESS_UPDATED_LINE_MISSING'));
  for (const section of REQUIRED_SECTIONS) {
    if (!lines.some((line) => line.startsWith(section))) findings.push(finding('PROGRESS_SECTION_MISSING', { section }));
  }
  if (status === 'IN_PROGRESS' && !NEXT_STEP.test(text)) findings.push(finding('PROGRESS_NEXT_STEP_MISSING'));
  if (status === 'ALL_MILESTONES_DONE' && !uatAllPass) findings.push(finding('PROGRESS_DONE_WITHOUT_UAT'));
  if (status === 'BLOCKED') {
    const body = blockerSection(lines);
    const complete = BLOCKER_PARTS.every((n) => body.some((line) => line.startsWith(`${n}.`)));
    if (!complete) findings.push(finding('PROGRESS_BLOCKER_REPORT_INCOMPLETE'));
  }
  return findings;
}
