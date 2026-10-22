import { finding } from './finding.mjs';
import { conforms, tenantTables } from '../rls.mjs';
import { finalPolicies } from '../sql.mjs';

export function checkRlsConvention(model) {
  const policies = finalPolicies(model.sql);
  return tenantTables(model.sql)
    .filter((table) => !conforms(policies.get(table)))
    .map((table) => finding('RLS_POLICY_CONVENTION', { table }));
}
