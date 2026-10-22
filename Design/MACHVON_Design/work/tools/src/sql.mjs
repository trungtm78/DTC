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
