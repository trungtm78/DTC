import { finding } from './finding.mjs';
import { extractOpenApi, extractPlan, registeredCodes } from '../error-code-inventory.mjs';

// Every error code the OpenAPI document declares or the plan's acceptance criteria promise must be
// in the registry (error_codes.json), so a Problem+JSON filter can validate emitted codes against it.
// Skipped while the package has no registry; codes only the specs or tests name are reported by the
// inventory tool, not enforced here.

const EXTRACTORS = [
  ['openapi', (model) => extractOpenApi(model.openapi)],
  ['plan', (model) => extractPlan(model.plan)],
];

export function checkErrorCodeRegistered(model) {
  if (!model.errorCodes?.registry) return [];
  const registered = registeredCodes(model.errorCodes);
  const where = new Map();
  for (const [source, extract] of EXTRACTORS) {
    for (const { code } of extract(model)) {
      if (registered.has(code)) continue;
      where.set(code, [...new Set([...(where.get(code) ?? []), source])]);
    }
  }
  return [...where]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, sources]) => finding('ERROR_CODE_UNREGISTERED', { code, where: sources.join(', ') }));
}
