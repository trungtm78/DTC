import { finding } from './finding.mjs';
import { requirementIds, testReferenceSources } from './references.mjs';

export function checkTestReferences(model) {
  const testIds = new Set(model.tests.map((t) => t.id));
  const knownRequirements = requirementIds(model);
  const referenced = new Set();
  const findings = [];

  for (const { from, ids } of testReferenceSources(model)) {
    for (const id of ids) {
      referenced.add(id);
      if (!testIds.has(id)) findings.push(finding('UNKNOWN_TEST_REF', { from, id }));
    }
  }
  for (const test of model.tests) {
    const covers = test.covers ?? [];
    for (const requirement of covers) {
      if (!knownRequirements.has(requirement)) {
        findings.push(finding('UNKNOWN_COVERED_REQUIREMENT', { id: test.id, requirement }));
      }
    }
    if (!referenced.has(test.id) && covers.length === 0) findings.push(finding('ORPHAN_TEST', { id: test.id }));
  }
  return findings;
}
