import { finding } from './finding.mjs';
import { testsCoveringRequirement } from './references.mjs';

export function checkRequirementCoverage(model) {
  const findings = [];
  const functional = new Set(model.trace.map((row) => row.requirement));

  for (const requirement of functional) {
    if (testsCoveringRequirement(model, requirement).length === 0) {
      findings.push(finding('FR_WITHOUT_TEST', { requirement }));
    }
  }
  for (const nfr of model.nonFunctional ?? []) {
    if ((nfr.controls ?? []).length === 0) findings.push(finding('NFR_WITHOUT_CONTROL', { requirement: nfr.id }));
    if (testsCoveringRequirement(model, nfr.id).length === 0) {
      findings.push(finding('NFR_WITHOUT_TEST', { requirement: nfr.id }));
    }
  }
  return findings;
}
