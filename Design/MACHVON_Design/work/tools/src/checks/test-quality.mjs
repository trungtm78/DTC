import { finding } from './finding.mjs';

export const DEFAULT_TEMPLATE_THRESHOLD = 3;

export function checkTestQuality(model, { templateThreshold = DEFAULT_TEMPLATE_THRESHOLD } = {}) {
  const findings = [];
  const p0BySteps = new Map();

  for (const test of model.tests) {
    if (!String(test.expected ?? '').trim()) findings.push(finding('TEST_EXPECTED_MISSING', { id: test.id }));
    if (test.priority !== 'P0') continue;
    const key = JSON.stringify(test.steps ?? []);
    p0BySteps.set(key, [...(p0BySteps.get(key) ?? []), test.id]);
  }
  for (const ids of p0BySteps.values()) {
    if (ids.length < templateThreshold) continue;
    for (const id of ids) findings.push(finding('TEST_TEMPLATE_STEPS', { id, sharedWith: ids.length }));
  }
  return findings;
}
