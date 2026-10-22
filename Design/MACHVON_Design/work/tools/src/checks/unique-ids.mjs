import { finding } from './finding.mjs';

const COLLECTIONS = ['screens', 'backlog', 'tests', 'nonFunctional'];

export function checkUniqueIds(model) {
  const findings = [];
  for (const collection of COLLECTIONS) {
    const seen = new Set();
    for (const { id } of model[collection] ?? []) {
      if (seen.has(id)) findings.push(finding('DUPLICATE_ID', { collection, id }));
      seen.add(id);
    }
  }
  return findings;
}
