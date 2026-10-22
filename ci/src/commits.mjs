import { finding } from './finding.mjs';

export const MAX_SUBJECT_LENGTH = 100;
const CONVENTIONAL = /^(feat|fix|docs|chore|refactor|test|perf|build|ci|style|revert)(\([^)]+\))?!?: \S.*/;
const NON_ASCII = /[^\x00-\x7F]/;

export function checkCommitSubjects(subjects) {
  return subjects.flatMap((subject) => {
    const findings = [];
    if (!CONVENTIONAL.test(subject)) findings.push(finding('COMMIT_NOT_CONVENTIONAL', { subject: subject.slice(0, 60) }));
    if (NON_ASCII.test(subject)) findings.push(finding('COMMIT_NOT_ENGLISH', { subject: subject.slice(0, 60) }));
    if (subject.length > MAX_SUBJECT_LENGTH) findings.push(finding('COMMIT_SUBJECT_TOO_LONG', { length: subject.length }));
    return findings;
  });
}
