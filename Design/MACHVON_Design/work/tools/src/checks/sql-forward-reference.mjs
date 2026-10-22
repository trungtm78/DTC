import { finding } from './finding.mjs';

// PostgreSQL rejects a REFERENCES clause whose target table does not exist yet, so every target must
// be created earlier in the file. Foreign keys belong in the managed _FK section for that reason.
const CREATE_TABLE = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/g;
const OWNER = /(?:CREATE TABLE\s+(?:IF NOT EXISTS\s+)?|ALTER TABLE\s+(?:ONLY\s+)?)(\w+)/g;
const REFERENCES = /\bREFERENCES\s+(\w+)\s*\(/g;

// Comments may mention REFERENCES; blank them without moving any offset.
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, (comment) => ' '.repeat(comment.length));

function ownerAt(owners, offset) {
  let current = '';
  for (const owner of owners) {
    if (owner.offset > offset) break;
    current = owner.name;
  }
  return current;
}

export function checkSqlForwardReference(model) {
  const sql = withoutComments(model.sql);
  const created = new Map();
  for (const match of sql.matchAll(CREATE_TABLE)) if (!created.has(match[1])) created.set(match[1], match.index);
  const owners = [...sql.matchAll(OWNER)].map((match) => ({ name: match[1], offset: match.index }));
  return [...sql.matchAll(REFERENCES)]
    .filter((match) => created.has(match[1]) && created.get(match[1]) > match.index)
    .map((match) => finding('SQL_FORWARD_REFERENCE', { table: ownerAt(owners, match.index), target: match[1] }));
}
