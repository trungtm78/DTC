import { finalPolicies, parseSql } from './sql.mjs';
import { mergeSqlSection } from './merge.mjs';

// Row-level security convention (basic design, decision R6/A1): every tenant table carries a
// RESTRICTIVE tenant_boundary policy and a PERMISSIVE tenant_access policy, because PostgreSQL
// denies every row when only RESTRICTIVE policies exist. Other policies (scope guards, relay
// access) are module-specific and kept. The managed section is always the last one in the file so
// tables added by later modules are covered.

export const RLS_MODULE = '_RLS';
const PREDICATE = "tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid";
const LEGACY_NAMES = new Set(['tenant_guard']);

export function conforms(policies = []) {
  const has = (name, kind) => policies.some((policy) => policy.name === name && policy.kind === kind);
  return has('tenant_boundary', 'RESTRICTIVE') && has('tenant_access', 'PERMISSIVE');
}

export function tenantTables(sql) {
  const { tables } = parseSql(sql);
  return [...tables.values()].filter((table) => table.columns.includes('tenant_id')).map((table) => table.name);
}

function sectionPattern() {
  return new RegExp(String.raw`\n*-- BEGIN module ${RLS_MODULE}[\s\S]*?-- END module ${RLS_MODULE}\n*`);
}

function statementsFor(table, existing) {
  const statements = [`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`];
  for (const policy of existing) {
    if (policy.name === 'tenant_boundary' || policy.name === 'tenant_access' || LEGACY_NAMES.has(policy.name)) {
      statements.push(`DROP POLICY IF EXISTS ${policy.name} ON ${table};`);
    }
  }
  statements.push(
    `CREATE POLICY tenant_boundary ON ${table} AS RESTRICTIVE USING (${PREDICATE}) WITH CHECK (${PREDICATE});`,
    `CREATE POLICY tenant_access ON ${table} AS PERMISSIVE USING (${PREDICATE}) WITH CHECK (${PREDICATE});`,
  );
  return statements;
}

export function normalizeRls(sql) {
  const withoutSection = sql.replace(sectionPattern(), '\n').trimEnd();
  const policies = finalPolicies(withoutSection);
  const ddl = tenantTables(withoutSection)
    .filter((table) => !conforms(policies.get(table)))
    .flatMap((table) => statementsFor(table, policies.get(table) ?? []));
  if (ddl.length === 0) return sql.replace(sectionPattern(), '\n').trimEnd() === sql.trimEnd() ? sql : `${withoutSection}\n`;
  return mergeSqlSection(withoutSection, RLS_MODULE, ddl.join('\n'));
}
