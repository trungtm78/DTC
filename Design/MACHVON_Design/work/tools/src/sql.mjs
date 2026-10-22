// Small parser for the reference schema dialect used in schema_reference.sql.
// It extracts only what the consistency checks need: tables, columns, RLS and indexes.

const CREATE_TABLE = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi;
const ENABLE_RLS = /ALTER TABLE\s+(\w+)\s+ENABLE ROW LEVEL SECURITY/gi;
const CREATE_INDEX =
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?\w+\s+ON\s+(\w+)\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/gi;
const COLUMN_NAME = /^\s*(\w+)\s+\w/;
const CONSTRAINT_WORDS = new Set(['PRIMARY', 'UNIQUE', 'FOREIGN', 'CONSTRAINT', 'CHECK', 'EXCLUDE']);

function columnsOf(body) {
  return body
    .split(/,(?![^()]*\))/)
    .map((part) => part.match(COLUMN_NAME)?.[1])
    .filter((name) => name && !CONSTRAINT_WORDS.has(name.toUpperCase()));
}

export function parseSql(sql) {
  const tables = new Map();
  for (const [, name, body] of sql.matchAll(CREATE_TABLE)) tables.set(name, { name, columns: columnsOf(body) });
  const rls = new Set([...sql.matchAll(ENABLE_RLS)].map(([, name]) => name));
  const indexes = [...sql.matchAll(CREATE_INDEX)].map(([, table, columns]) => ({
    table,
    columns: columns.split(',').map((column) => column.trim().split(/\s+/)[0]),
  }));
  return { tables, rls, indexes };
}

const POLICY_STATEMENT = /(CREATE POLICY\s+(\w+)\s+ON\s+(\w+)(?:\s+AS\s+(RESTRICTIVE|PERMISSIVE))?|DROP POLICY\s+(?:IF EXISTS\s+)?(\w+)\s+ON\s+(\w+))/gi;

// Replays CREATE POLICY and DROP POLICY in file order and returns the policies each table ends up with.
export function finalPolicies(sql) {
  const policies = new Map();
  for (const match of sql.matchAll(POLICY_STATEMENT)) {
    const [, , createName, createTable, kind, dropName, dropTable] = match;
    if (createName) {
      const list = (policies.get(createTable) ?? []).filter((policy) => policy.name !== createName);
      policies.set(createTable, [...list, { name: createName, kind: (kind ?? 'PERMISSIVE').toUpperCase() }]);
    } else {
      policies.set(dropTable, (policies.get(dropTable) ?? []).filter((policy) => policy.name !== dropName));
    }
  }
  return policies;
}
