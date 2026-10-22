import { parseSql } from './sql.mjs';

// Renders the Mermaid entity-relationship diagrams from schema_reference.sql (the single source of
// truth). The reference dialect declares columns inline, adds columns and foreign keys with ALTER
// TABLE and groups tables in "-- BEGIN module <name>" sections; tables outside a section are "base".

export const BASE_MODULE = 'base';
export const MAX_MAIN_COLUMNS = 8;
const TENANT_COLUMN = 'tenant_id';
const AUDIT_COLUMNS = new Set(['created_at', 'created_by', 'updated_at', 'updated_by']);
const CONSTRAINT_START = /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b/i;
const COLUMN_KEYWORD = /\s+(?:NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|REFERENCES|UNIQUE|CHECK|GENERATED|CONSTRAINT|COLLATE)\b/i;
const TYPE_PATTERN = new RegExp(String.raw`^[\s\S]*?(?=${COLUMN_KEYWORD.source}|$)`, 'i');
const MODULE_SECTION = /-- BEGIN module (\w+)[\s\S]*?-- END module \1/g;
const ALTER_TABLE = /\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(\w+)\s+([^;]*);/gi;
const UNIQUE_INDEX =
  /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+(\w+)\s*(?:USING\s+\w+\s*)?\(([^)]*)\)([^;]*);/gi;
const ERD_ENTITY_OPEN = /^(\w+)\s*\{$/;
const ERD_RELATIONSHIP = /^(\w+)\s+([|}][|o](?:--|\.\.)[|o][|{])\s+(\w+)\s*:\s*(.*)$/;

// Blanks line comments with spaces so every other offset stays valid; dashes inside strings survive.
export function stripComments(sql) {
  let out = '';
  let quoted = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quoted) {
      quoted = char !== "'";
      out += char;
    } else if (char === "'") {
      quoted = true;
      out += char;
    } else if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      i -= 1;
    } else {
      out += char;
    }
  }
  return out;
}

function maskStrings(text) {
  return text.replace(/'[^']*'/g, (literal) => `'${'x'.repeat(literal.length - 2)}'`);
}

function maskNested(text) {
  let depth = 0;
  let out = '';
  for (const char of text) {
    if (char === ')') depth -= 1;
    out += depth > 0 ? '_' : char;
    if (char === '(') depth += 1;
  }
  return out;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      quoted = char !== "'";
    } else if (char === "'") {
      quoted = true;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const names = (list) => list.split(',').map((item) => item.trim().split(/\s+/)[0]).filter(Boolean);

function addUnique(table, columns) {
  if (!table.uniques.some((set) => set.join() === columns.join())) table.uniques.push(columns);
}

function parseColumn(definition) {
  const [, name, rest] = definition.match(/^(\w+)\s+([\s\S]+)$/) ?? [];
  if (!name) return undefined;
  const strings = maskStrings(rest);
  const outer = maskNested(strings);
  const type = rest.slice(0, outer.match(new RegExp(`^[\\s\\S]*?(?=${COLUMN_KEYWORD.source}|$)`, 'i'))[0].length).trim();
  const reference = strings.match(/\bREFERENCES\s+(\w+)\s*(?:\(([^)]*)\))?/i);
  return {
    column: { name, type, notNull: /\bNOT\s+NULL\b/i.test(outer) },
    primary: /\bPRIMARY\s+KEY\b/i.test(outer),
    unique: /\bUNIQUE\b/i.test(outer),
    reference: reference && { columns: [name], refTable: reference[1], refColumns: names(reference[2] ?? '') },
  };
}

function addColumn(table, definition) {
  const parsed = parseColumn(definition);
  if (!parsed || table.columns.some((column) => column.name === parsed.column.name)) return;
  table.columns.push(parsed.column);
  if (parsed.primary) table.primaryKey = [parsed.column.name];
  if (parsed.unique) addUnique(table, [parsed.column.name]);
  if (parsed.reference) table.foreignKeys.push(parsed.reference);
}

function applyConstraint(table, text) {
  const body = text.replace(/^CONSTRAINT\s+\w+\s+/i, '');
  const primary = body.match(/^PRIMARY\s+KEY\s*\(([^)]*)\)/i);
  const unique = body.match(/^UNIQUE\s*\(([^)]*)\)/i);
  const foreign = body.match(/^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(\w+)\s*(?:\(([^)]*)\))?/i);
  if (primary) table.primaryKey = names(primary[1]);
  else if (unique) addUnique(table, names(unique[1]));
  else if (foreign) table.foreignKeys.push({ columns: names(foreign[1]), refTable: foreign[2], refColumns: names(foreign[3] ?? '') });
}

function dropColumn(table, name) {
  table.columns = table.columns.filter((column) => column.name !== name);
  table.uniques = table.uniques.filter((set) => !set.includes(name));
  table.foreignKeys = table.foreignKeys.filter((fk) => !fk.columns.includes(name));
}

function applyAlter(table, action) {
  const addColumnMatch = action.match(/^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i);
  const dropMatch = action.match(/^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
  const typeMatch = action.match(/^ALTER\s+COLUMN\s+(\w+)\s+(?:SET\s+DATA\s+)?TYPE\s+([\s\S]+?)(?:\s+USING\b[\s\S]*)?$/i);
  const nullMatch = action.match(/^ALTER\s+COLUMN\s+(\w+)\s+(SET|DROP)\s+NOT\s+NULL/i);
  const constraintMatch = action.match(/^ADD\s+([\s\S]+)$/i);
  if (addColumnMatch) addColumn(table, addColumnMatch[1]);
  else if (dropMatch) dropColumn(table, dropMatch[1]);
  else if (typeMatch) {
    const column = table.columns.find((item) => item.name === typeMatch[1]);
    if (column) column.type = typeMatch[2].trim();
  } else if (nullMatch) {
    const column = table.columns.find((item) => item.name === nullMatch[1]);
    if (column) column.notNull = nullMatch[2].toUpperCase() === 'SET';
  } else if (constraintMatch) applyConstraint(table, constraintMatch[1]);
}

function moduleRanges(sql) {
  return [...sql.matchAll(MODULE_SECTION)].map((match) => ({
    name: match[1],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

// Reads every table of the reference schema: columns with type and nullability, primary key,
// unique sets, foreign keys and the module section the table is created in.
export function parseSchema(sql) {
  const clean = stripComments(sql);
  const ranges = moduleRanges(sql);
  const tables = new Map();
  for (const parsed of parseSql(clean).tables.values()) {
    const table = {
      name: parsed.name,
      module: ranges.find((range) => parsed.offset >= range.start && parsed.offset < range.end)?.name ?? BASE_MODULE,
      columns: [],
      primaryKey: [],
      uniques: [],
      foreignKeys: [],
    };
    for (const part of splitTopLevel(parsed.body)) {
      if (CONSTRAINT_START.test(part)) applyConstraint(table, part);
      else addColumn(table, part);
    }
    tables.set(table.name, table);
  }
  for (const [, name, actions] of clean.matchAll(ALTER_TABLE)) {
    const table = tables.get(name);
    if (table) for (const action of splitTopLevel(actions)) applyAlter(table, action);
  }
  for (const [, name, columns, tail] of clean.matchAll(UNIQUE_INDEX)) {
    const list = names(columns);
    const table = tables.get(name);
    if (table && !/\bWHERE\b/i.test(tail) && list.every((item) => /^\w+$/.test(item))) addUnique(table, list);
  }
  for (const table of tables.values()) {
    for (const column of table.columns) if (table.primaryKey.includes(column.name)) column.notNull = true;
  }
  return { tables, order: [...tables.keys()] };
}

// Mermaid attribute types allow letters, digits, underscores and brackets only.
export function compactType(raw) {
  const text = raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace('timestamp with time zone', 'timestamptz')
    .replace('timestamp without time zone', 'timestamp')
    .replace('character varying', 'varchar');
  return text.replace(/[^a-z0-9[\]]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

const labelColumns = (fk) => (fk.columns.length > 1 ? fk.columns.filter((column) => column !== TENANT_COLUMN) : fk.columns);

// One entry per foreign key whose parent table exists: parent ||--o{ child, with the cardinality
// taken from the child side (nullable columns make the parent optional; a key that contains the
// child's primary key or a unique set makes the link one-to-one).
export function relationships(schema) {
  const found = [];
  const seen = new Set();
  for (const name of schema.order) {
    const table = schema.tables.get(name);
    for (const fk of table.foreignKeys.filter((item) => schema.tables.has(item.refTable))) {
      const label = labelColumns(fk).join('+');
      const key = `${fk.refTable}|${name}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const optional = labelColumns(fk).some((column) => !table.columns.find((item) => item.name === column)?.notNull);
      const unique = [table.primaryKey, ...table.uniques].some((set) => set.length > 0 && set.every((column) => fk.columns.includes(column)));
      found.push({ parent: fk.refTable, child: name, label, symbol: `${optional ? '|o' : '||'}--${unique ? 'o|' : 'o{'}` });
    }
  }
  return found;
}

function entityLines(schema, table, maxMainColumns) {
  const foreign = new Set(
    table.foreignKeys.filter((fk) => schema.tables.has(fk.refTable)).flatMap(labelColumns),
  );
  const uniqueSingles = new Set(table.uniques.filter((set) => set.length === 1).flat());
  const byName = new Map(table.columns.map((column) => [column.name, column]));
  const keyColumns = [
    ...table.primaryKey.filter((name) => byName.has(name)),
    ...table.columns.map((column) => column.name).filter((name) => foreign.has(name) && !table.primaryKey.includes(name)),
  ];
  const main = table.columns
    .map((column) => column.name)
    .filter((name) => !keyColumns.includes(name) && !AUDIT_COLUMNS.has(name))
    .slice(0, maxMainColumns);
  return [...keyColumns, ...main].map((name) => {
    const marks = [
      table.primaryKey.includes(name) && 'PK',
      foreign.has(name) && 'FK',
      uniqueSingles.has(name) && !table.primaryKey.includes(name) && 'UK',
    ].filter(Boolean);
    return `        ${compactType(byName.get(name).type)} ${name}${marks.length ? ` ${marks.join(', ')}` : ''}`;
  });
}

const header = (module, maxMainColumns) => [
  '    %% Generated by work/tools/src/erd-cli.mjs from 03_Engineering/schema_reference.sql (npm run erd); do not edit by hand.',
  module === undefined
    ? '    %% Full diagram: it exceeds the default Mermaid limits (maxTextSize 50000, maxEdges 500); raise them in the renderer or open the per-module ERD_<MODULE>.mmd files.'
    : `    %% Module "${module}" only: relationships owned by its tables are drawn; parents in other modules appear as bare entities.`,
  `    %% Attributes: primary key, foreign keys and up to ${maxMainColumns} main columns; audit columns are omitted.`,
  '    %% Every tenant table also carries tenant_id (the first key column) and is isolated by RLS; that link is not drawn.',
  '    %% Cardinality: |o optional parent (nullable FK), || required parent, o| one child (FK covers a unique key), o{ many children.',
];

export function renderDiagram(schema, { module, maxMainColumns = MAX_MAIN_COLUMNS } = {}) {
  const names = schema.order.filter((name) => module === undefined || schema.tables.get(name).module === module);
  const own = new Set(names);
  const lines = ['erDiagram', ...header(module, maxMainColumns)];
  for (const name of names) {
    lines.push(`    ${name} {`, ...entityLines(schema, schema.tables.get(name), maxMainColumns), '    }');
  }
  for (const rel of relationships(schema).filter((item) => own.has(item.child))) {
    lines.push(`    ${rel.parent} ${rel.symbol} ${rel.child} : "${rel.label}"`);
  }
  return `${lines.join('\n')}\n`;
}

// The full diagram plus one diagram per schema module (the full one is large for a single viewer).
export function renderErd(sql, options = {}) {
  const schema = parseSchema(sql);
  const moduleNames = [...new Set(schema.order.map((name) => schema.tables.get(name).module))];
  return {
    schema,
    full: renderDiagram(schema, options),
    modules: new Map(moduleNames.map((module) => [module, renderDiagram(schema, { ...options, module })])),
    entityCount: schema.order.length,
    relationshipCount: relationships(schema).length,
  };
}

// Reads a Mermaid erDiagram: entity blocks (attribute lines) and relationship lines. An entity
// known only from a relationship has null attributes.
export function parseErd(text = '') {
  const entities = new Map();
  const found = [];
  let open = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const opening = line.match(ERD_ENTITY_OPEN);
    const relation = line.match(ERD_RELATIONSHIP);
    if (open) {
      if (line === '}') open = null;
      else if (line) open.push(line);
    } else if (opening) {
      open = [];
      entities.set(opening[1], open);
    } else if (relation) {
      const [, parent, symbol, child, label] = relation;
      for (const name of [parent, child]) if (!entities.has(name)) entities.set(name, null);
      found.push({ parent, child, symbol, label: label.trim().replace(/^"(.*)"$/, '$1') });
    }
  }
  return { entities, relationships: found };
}

export const erdEntities = (text) => new Set(parseErd(text).entities.keys());

const pairKey = (rel) => `${rel.parent}>${rel.child}`;

function compareRelationships(before, after) {
  const afterByPair = new Map();
  for (const rel of after) afterByPair.set(pairKey(rel), [...(afterByPair.get(pairKey(rel)) ?? []), rel]);
  const beforeCount = new Map();
  for (const rel of before) beforeCount.set(pairKey(rel), (beforeCount.get(pairKey(rel)) ?? 0) + 1);
  const lost = [];
  const changed = [];
  for (const rel of before) {
    const candidates = afterByPair.get(pairKey(rel)) ?? [];
    const match =
      candidates.find((item) => item.label === rel.label) ??
      candidates.find((item) => item.label.includes(rel.label)) ??
      (beforeCount.get(pairKey(rel)) === 1 && candidates.length === 1 ? candidates[0] : undefined);
    if (!match) lost.push(pairKey(rel));
    else if (match.symbol !== rel.symbol || match.label !== rel.label) changed.push({ key: pairKey(rel), before: rel, after: match });
  }
  return { lost, changed };
}

// Compares a previous ERD with a regenerated one by entity name: entities that disappeared,
// entities whose attribute block changed (only when the previous one had a block) and relationships
// whose cardinality or label changed.
export function compareErd(previous, next) {
  const before = parseErd(previous);
  const after = parseErd(next);
  const changedEntities = [];
  for (const [name, attributes] of before.entities) {
    const current = after.entities.get(name);
    if (!attributes || !current) continue;
    const added = current.filter((line) => !attributes.includes(line));
    const removed = attributes.filter((line) => !current.includes(line));
    if (added.length > 0 || removed.length > 0) changedEntities.push({ name, added, removed });
  }
  const relations = compareRelationships(before.relationships, after.relationships);
  return {
    entitiesBefore: before.entities.size,
    entitiesAfter: after.entities.size,
    relationshipsBefore: before.relationships.length,
    relationshipsAfter: after.relationships.length,
    lostEntities: [...before.entities.keys()].filter((name) => !after.entities.has(name)),
    changedEntities,
    lostRelationships: relations.lost,
    changedRelationships: relations.changed,
  };
}
