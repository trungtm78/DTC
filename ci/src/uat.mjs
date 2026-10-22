import { finding } from './finding.mjs';

// UAT-COVERAGE.md matrix (protocol section 9): ID | Screen/Function | Written | Run | Result.
const RESULT_COLUMN = 4;
const SEPARATOR_ROW = /^\|?\s*:?-{3,}/;

function dataRows(markdown) {
  const tableLines = markdown.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  return tableLines
    .slice(1)
    .filter((line) => !SEPARATOR_ROW.test(line.trim().replace(/^\|\s*/, '|')))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

export function checkUatCoverage(markdown) {
  if (markdown === undefined) return { allPass: false, findings: [finding('UAT_MATRIX_MISSING')] };
  const rows = dataRows(markdown);
  if (rows.length === 0) return { allPass: false, findings: [finding('UAT_MATRIX_EMPTY')] };
  const findings = rows
    .filter((row) => row[RESULT_COLUMN] !== 'PASS')
    .map((row) => finding('UAT_ROW_NOT_PASS', { id: row[0], result: row[RESULT_COLUMN] ?? '' }));
  return { allPass: findings.length === 0, findings };
}
