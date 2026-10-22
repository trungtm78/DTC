import { readFileSync } from 'node:fs';
import { finding } from './finding.mjs';

// The section 7 template of AUTONOMOUS_EXECUTION_PROTOCOL.md is written in Vietnamese. Its
// labels are loaded from a resource file and matched by prefix.
const CONTRACT = JSON.parse(readFileSync(new URL('./protocol-contract.json', import.meta.url), 'utf8'));
const NEXT_STEP = new RegExp(`^${CONTRACT.nextStepLabel}\\s*\\S+`, 'm');

export const STATUSES = ['IN_PROGRESS', 'ALL_MILESTONES_DONE', 'BLOCKED'];
export const REQUIRED_SECTIONS = CONTRACT.requiredSections;
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
  if (!lines.some((line) => line.startsWith(CONTRACT.updatedLabel))) findings.push(finding('PROGRESS_UPDATED_LINE_MISSING'));
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
