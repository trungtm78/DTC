import { parseAddedLines } from './diff.mjs';
import { finding } from './finding.mjs';

// Paths never scanned: the gate's own tests deliberately contain banned patterns as fixtures,
// and rules.mjs spells the patterns out as text.
export const IGNORED_PATHS = [/^ci\/test\//, /^ci\/src\/rules\.mjs$/];

function isIgnored(file) {
  return IGNORED_PATHS.some((pattern) => pattern.test(file));
}

export function scanDiff(diffText, rules) {
  const findings = [];
  for (const { file, line, text } of parseAddedLines(diffText)) {
    if (isIgnored(file)) continue;
    for (const rule of rules) {
      // The offending text is never echoed: secrets must not leak into CI logs.
      if (rule.appliesTo(file) && rule.test(text)) {
        findings.push(finding(rule.code, { file, line }, rule.severity ?? 'error'));
      }
    }
  }
  return findings;
}
