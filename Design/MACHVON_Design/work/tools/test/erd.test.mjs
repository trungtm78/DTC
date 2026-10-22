import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSql } from '../src/sql.mjs';
import {
  compactType,
  compareErd,
  erdEntities,
  parseErd,
  parseSchema,
  relationships,
  renderDiagram,
  renderErd,
  stripComments,
} from '../src/erd.mjs';
import { checkErd } from '../src/checks/erd.mjs';
import { erdMain } from '../src/erd-cli.mjs';
import { loadMessages } from '../src/i18n.mjs';
import { ENGINEERING_FILES, loadModel } from '../src/model.mjs';
import { validModel } from './fixtures.mjs';

const SAMPLE = `
-- header comment with an 'unbalanced quote and, commas
CREATE TABLE tenant (
  id uuid NOT NULL,
  code text NOT NULL, -- trailing comment, (with parens
  PRIMARY KEY (id),
  UNIQUE (code)
);

-- BEGIN module alpha
CREATE TABLE unit (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  parent_id uuid,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE project (
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  id uuid NOT NULL,
  code text NOT NULL,
  budget numeric(18,2) NOT NULL DEFAULT 0 CHECK (budget >= 0 AND code IS NOT NULL),
  note text DEFAULT 'a, b -- not a comment',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT project_code_uq UNIQUE (tenant_id, code),
  CHECK (budget < 1000)
);
-- END module alpha
-- BEGIN module beta
CREATE TABLE report (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  reviewer_id uuid,
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE report_summary (
  tenant_id uuid NOT NULL,
  report_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, report_id),
  FOREIGN KEY (tenant_id, report_id) REFERENCES report(tenant_id, id)
);
CREATE TABLE tenant_pointer (
  tenant_id uuid PRIMARY KEY REFERENCES tenant(id),
  slug text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- END module beta
ALTER TABLE unit ADD FOREIGN KEY (tenant_id,parent_id) REFERENCES unit(tenant_id,id);
ALTER TABLE project ADD FOREIGN KEY (tenant_id,code) REFERENCES missing_table(tenant_id,id);
ALTER TABLE report ADD FOREIGN KEY (tenant_id,project_id) REFERENCES project(tenant_id,id);
ALTER TABLE report ADD FOREIGN KEY (tenant_id,project_id) REFERENCES project(tenant_id,id);
ALTER TABLE report ADD CONSTRAINT report_reviewer_fk FOREIGN KEY (tenant_id,reviewer_id) REFERENCES unit(tenant_id,id);
ALTER TABLE report ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT', ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone;
ALTER TABLE report ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE report ADD COLUMN owner_id uuid REFERENCES unit(id);
ALTER TABLE report ADD COLUMN scratch text;
ALTER TABLE report DROP COLUMN scratch;
ALTER TABLE report ALTER COLUMN reviewer_id SET NOT NULL;
ALTER TABLE report ALTER COLUMN reviewer_id DROP NOT NULL;
ALTER TABLE report ALTER COLUMN status SET DATA TYPE varchar(20);
ALTER TABLE report ADD UNIQUE (tenant_id, status);
ALTER TABLE report ADD CONSTRAINT report_pk PRIMARY KEY (tenant_id, id);
ALTER TABLE report ADD CONSTRAINT report_status_ck CHECK (status IN ('DRAFT','DONE'));
ALTER TABLE report ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghost ADD COLUMN x int;
CREATE UNIQUE INDEX report_status_uq ON report (tenant_id, status DESC);
CREATE UNIQUE INDEX report_partial_uq ON report (tenant_id, closed_at) WHERE closed_at IS NOT NULL;
CREATE UNIQUE INDEX report_expr_uq ON report (lower(status));
CREATE INDEX report_plain_idx ON report (project_id);
`;

test('stripComments blanks comments with the same length and ignores dashes inside strings', () => {
  const sql = "SELECT 'a -- b'; -- gone\nSELECT 2;";
  const stripped = stripComments(sql);
  assert.equal(stripped.length, sql.length);
  assert.ok(stripped.includes("'a -- b'"));
  assert.ok(!stripped.includes('gone'));
  assert.equal(stripped.split('\n').length, 2);
});

test('compactType yields characters Mermaid accepts', () => {
  assert.equal(compactType('uuid'), 'uuid');
  assert.equal(compactType('NUMERIC(18, 2)'), 'numeric_18_2');
  assert.equal(compactType('char(64)'), 'char_64');
  assert.equal(compactType('timestamp with time zone'), 'timestamptz');
  assert.equal(compactType('timestamp without time zone'), 'timestamp');
  assert.equal(compactType('character varying(20)'), 'varchar_20');
  assert.equal(compactType('text[]'), 'text[]');
  assert.equal(compactType('double precision'), 'double_precision');
  assert.equal(compactType(''), 'unknown');
});

test('parseSchema reads columns, keys and nullability from CREATE TABLE', () => {
  const { tables, order } = parseSchema(SAMPLE);
  assert.deepEqual(order, ['tenant', 'unit', 'project', 'report', 'report_summary', 'tenant_pointer']);
  const project = tables.get('project');
  assert.deepEqual(project.columns.map((c) => c.name), ['tenant_id', 'id', 'code', 'budget', 'note']);
  assert.deepEqual(project.primaryKey, ['tenant_id', 'id']);
  assert.deepEqual(project.uniques, [['tenant_id', 'code']]);
  const byName = Object.fromEntries(project.columns.map((c) => [c.name, c]));
  assert.equal(byName.budget.type, 'numeric(18,2)');
  assert.equal(byName.budget.notNull, true);
  assert.equal(byName.note.notNull, false, 'a DEFAULT string is not a constraint');
  assert.equal(byName.note.type, 'text');
  assert.equal(byName.id.notNull, true, 'primary key columns are implicitly not null');
  assert.deepEqual(project.foreignKeys[0], { columns: ['tenant_id'], refTable: 'tenant', refColumns: ['id'] });
});

test('parseSchema handles inline primary key, inline unique and the table module', () => {
  const { tables } = parseSchema(SAMPLE);
  const pointer = tables.get('tenant_pointer');
  assert.deepEqual(pointer.primaryKey, ['tenant_id']);
  assert.deepEqual(pointer.uniques, [['slug']]);
  assert.equal(tables.get('tenant').module, 'base');
  assert.equal(tables.get('project').module, 'alpha');
  assert.equal(tables.get('report').module, 'beta');
});

test('parseSchema applies ALTER TABLE statements in file order', () => {
  const report = parseSchema(SAMPLE).tables.get('report');
  const byName = Object.fromEntries(report.columns.map((c) => [c.name, c]));
  assert.deepEqual(report.columns.map((c) => c.name), ['tenant_id', 'id', 'project_id', 'reviewer_id', 'status', 'closed_at', 'owner_id']);
  assert.equal(byName.status.type, 'varchar(20)', 'ALTER COLUMN TYPE wins and ADD COLUMN IF NOT EXISTS does not duplicate');
  assert.equal(byName.closed_at.type, 'timestamp with time zone');
  assert.equal(byName.reviewer_id.notNull, false, 'SET NOT NULL then DROP NOT NULL leaves it nullable');
  assert.deepEqual(report.primaryKey, ['tenant_id', 'id']);
  assert.equal(report.uniques.filter((set) => set.join() === 'tenant_id,status').length, 1, 'the same unique set is kept once');
  assert.ok(!report.uniques.some((set) => set.includes('closed_at')), 'partial unique indexes do not define a one-to-one');
  assert.ok(!report.uniques.some((set) => set.some((c) => c.includes('('))), 'expression indexes are ignored');
  assert.equal(report.foreignKeys.length, 4, 'every declared foreign key is kept; the renderer merges duplicates');
});

test('relationships derive cardinality from nullability and uniqueness', () => {
  const lines = relationships(parseSchema(SAMPLE)).map((r) => `${r.parent} ${r.symbol} ${r.child} ${r.label}`);
  assert.deepEqual(lines, [
    'unit |o--o{ unit parent_id',
    'tenant ||--o{ project tenant_id',
    'project ||--o{ report project_id',
    'unit |o--o{ report reviewer_id',
    'unit |o--o{ report owner_id',
    'report ||--o| report_summary report_id',
    'tenant ||--o| tenant_pointer tenant_id',
  ]);
});

test('relationships skip references to unknown tables and merge duplicate declarations', () => {
  const all = relationships(parseSchema(SAMPLE));
  assert.ok(!all.some((r) => r.parent === 'missing_table'));
  assert.equal(all.filter((r) => r.parent === 'project' && r.child === 'report').length, 1);
});

test('renderDiagram lists primary and foreign keys first, then main columns, capped and without audit columns', () => {
  const sql = [
    'CREATE TABLE parent (',
    '  id uuid NOT NULL,',
    '  PRIMARY KEY (id)',
    ');',
    `CREATE TABLE child (
      tenant_id uuid NOT NULL,
      id uuid NOT NULL,
      created_at timestamptz NOT NULL,
      created_by uuid,
      updated_at timestamptz,
      updated_by uuid,
      parent_id uuid NOT NULL,
      a text, b text, c text,
      PRIMARY KEY (tenant_id, id),
      FOREIGN KEY (tenant_id, parent_id) REFERENCES parent(tenant_id, id)
    );`,
  ].join('\n');
  const text = renderDiagram(parseSchema(sql), { maxMainColumns: 2 });
  const lines = text.split('\n');
  const child = lines.slice(lines.findIndex((l) => l.trim() === 'child {') + 1).map((l) => l.trim());
  assert.deepEqual(child.slice(0, 6), ['uuid tenant_id PK', 'uuid id PK', 'uuid parent_id FK', 'text a', 'text b', '}']);
  assert.ok(!text.includes('created_at'));
  assert.ok(!text.includes('text c'));
  assert.ok(text.startsWith('erDiagram\n'));
  assert.ok(text.endsWith('\n'));
  assert.match(text, /Full diagram: it exceeds/);
  assert.match(renderDiagram(parseSchema(sql), { module: 'base' }), /Module "base" only/);
});

test('renderDiagram marks unique single columns and combined keys', () => {
  const text = renderDiagram(parseSchema(SAMPLE));
  assert.ok(text.includes('        uuid tenant_id PK, FK'));
  assert.ok(text.includes('        text slug UK'));
  assert.ok(text.includes('        text code UK'));
  assert.ok(text.includes('        text code\n'));
  assert.ok(!/created_at/.test(text));
  assert.ok(text.includes('    tenant ||--o{ project : "tenant_id"'));
});

test('renderDiagram can be limited to one module and keeps relationships owned by it', () => {
  const text = renderDiagram(parseSchema(SAMPLE), { module: 'beta' });
  assert.ok(text.includes('    report {'));
  assert.ok(!text.includes('    project {'));
  assert.ok(text.includes('project ||--o{ report : "project_id"'));
  assert.ok(!text.includes('tenant ||--o{ project'));
});

test('renderErd returns the full diagram and one diagram per module', () => {
  const result = renderErd(SAMPLE);
  assert.deepEqual([...result.modules.keys()], ['base', 'alpha', 'beta']);
  assert.equal(result.entityCount, 6);
  assert.equal(result.relationshipCount, 7);
  assert.deepEqual(erdEntities(result.full), new Set(['tenant', 'unit', 'project', 'report', 'report_summary', 'tenant_pointer']));
  assert.ok(result.modules.get('alpha').includes('project {'));
});

test('parseErd reads entity blocks and relationship lines', () => {
  const text = 'erDiagram\n    a ||--o{ b : "x_id"\n    a {\n        uuid id PK\n    }\n    c |o--o| a : owns\n    %% a ||--o{ z : "ignored"\n';
  const parsed = parseErd(text);
  assert.deepEqual([...parsed.entities.keys()].sort(), ['a', 'b', 'c']);
  assert.deepEqual(parsed.entities.get('a'), ['uuid id PK']);
  assert.equal(parsed.entities.get('b'), null, 'an entity known only from a relationship has no attribute block');
  assert.deepEqual(parsed.relationships, [
    { parent: 'a', child: 'b', symbol: '||--o{', label: 'x_id' },
    { parent: 'c', child: 'a', symbol: '|o--o|', label: 'owns' },
  ]);
  assert.deepEqual(erdEntities(text), new Set(['a', 'b', 'c']));
});

test('compareErd reports lost entities, changed attributes and changed relationships', () => {
  const before = ['erDiagram', '    a ||--o{ b : "x_id"', '    a ||--o{ c : "y_id"', '    a ||--o{ gone : "g"', '    a {', '        uuid id PK', '        text old', '    }'].join('\n');
  const after = ['erDiagram', '    a {', '        uuid id PK', '        text new', '    }', '    b {', '        uuid id PK', '    }', '    c {', '        uuid id PK', '    }', '    a |o--o{ b : "x_id"', '    a ||--o{ c : "other"'].join('\n');
  const report = compareErd(before, after);
  assert.equal(report.entitiesBefore, 4);
  assert.equal(report.entitiesAfter, 3);
  assert.deepEqual(report.lostEntities, ['gone']);
  assert.deepEqual(report.changedEntities, [{ name: 'a', added: ['text new'], removed: ['text old'] }]);
  assert.deepEqual(report.changedRelationships.map((r) => r.key), ['a>b', 'a>c']);
  assert.deepEqual(report.lostRelationships, ['a>gone']);
  assert.equal(report.relationshipsBefore, 3);
});

test('compareErd matches relationships between the same pair by label and treats a missing diagram as empty', () => {
  const before = 'erDiagram\n    u ||--o{ r : "a_id"\n    u ||--o{ r : "b_id"\n';
  const after = 'erDiagram\n    u ||--o{ r : "b_id"\n    u |o--o{ r : "a_id"\n';
  const report = compareErd(before, after);
  assert.deepEqual(report.changedRelationships.map((r) => r.key), ['u>r']);
  assert.deepEqual(report.lostRelationships, []);
  const renamed = compareErd('erDiagram\n    u ||--o{ r : base\n', 'erDiagram\n    u ||--o{ r : "base_id"\n    u ||--o{ r : "other_id"\n');
  assert.deepEqual(renamed.changedRelationships.map((r) => r.after.label), ['base_id'], 'a longer column label still matches its short name');
  assert.deepEqual(renamed.lostRelationships, []);
  const empty = compareErd(undefined, 'erDiagram\n    a {\n        uuid id PK\n    }\n');
  assert.equal(empty.entitiesBefore, 0);
  assert.deepEqual(empty.lostEntities, []);
});

test('checkErd reports every table that has no entity in ERD.mmd', () => {
  const model = validModel();
  assert.deepEqual(checkErd({ ...model, erd: undefined }), [], 'no ERD file means nothing to compare');
  const findings = checkErd({ ...model, erd: 'erDiagram\n    tenant {\n        uuid id PK\n    }\n' });
  assert.deepEqual(findings.map((f) => f.code), ['ERD_ENTITY_MISSING']);
  assert.deepEqual(findings[0].params, { table: 'project' });
  assert.deepEqual(checkErd({ ...model, erd: 'erDiagram\n    tenant ||--o{ project : "x"\n' }), []);
});

test('every ERD message exists in each locale', () => {
  for (const locale of ['en', 'vi']) {
    const messages = loadMessages(locale);
    for (const key of [
      'check.finding.erdEntityMissing',
      'erd.written',
      'erd.compare.summary',
      'erd.compare.entityLost',
      'erd.compare.entityChanged',
      'erd.compare.relationshipChanged',
      'erd.compare.relationshipLost',
      'erd.stale',
      'erd.upToDate',
    ]) {
      assert.ok(messages[key], `${locale} misses ${key}`);
    }
  }
});

function writeDir(erd) {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-erd-'));
  writeFileSync(join(dir, ENGINEERING_FILES.sql), SAMPLE, 'utf8');
  if (erd !== undefined) writeFileSync(join(dir, 'ERD.mmd'), erd, 'utf8');
  return dir;
}

test('erd CLI writes the full diagram and one file per module, then reports the comparison', () => {
  const dir = writeDir('erDiagram\n    tenant ||--o{ project : "tenant_id"\n    tenant ||--o{ vanished : "x"\n');
  const lines = [];
  assert.equal(erdMain(['--dir', dir, '--locale', 'en'], (line) => lines.push(line)), 0);
  assert.ok(existsSync(join(dir, 'ERD.mmd')));
  for (const module of ['BASE', 'ALPHA', 'BETA']) assert.ok(existsSync(join(dir, `ERD_${module}.mmd`)), module);
  assert.ok(readFileSync(join(dir, 'ERD.mmd'), 'utf8').includes('tenant_pointer {'));
  const output = lines.join('\n');
  assert.match(output, /ERD\.mmd/);
  assert.match(output, /vanished/);
  assert.match(output, /Entities before: 3, after: 6/);
});

test('erd CLI reports changed attributes and relationships of a previous diagram', () => {
  const dir = writeDir('erDiagram\n    tenant ||--o{ project : "owns"\n    project {\n        uuid id PK\n        text legacy\n    }\n');
  const lines = [];
  erdMain(['--dir', dir, '--locale', 'en'], (line) => lines.push(line));
  const output = lines.join('\n');
  assert.match(output, /project/);
  assert.match(output, /legacy/);
  assert.match(output, /tenant>project/);
});

test('erd CLI --check passes when the files are current and fails when stale', () => {
  const dir = writeDir();
  const lines = [];
  assert.equal(erdMain(['--dir', dir, '--check', '--locale', 'en'], (line) => lines.push(line)), 1, 'nothing written yet');
  assert.match(lines.join('\n'), /ERD\.mmd/);
  assert.equal(erdMain(['--dir', dir, '--locale', 'en'], () => {}), 0);
  const again = [];
  assert.equal(erdMain(['--dir', dir, '--check', '--locale', 'vi'], (line) => again.push(line)), 0);
  assert.ok(again.length > 0);
  writeFileSync(join(dir, 'ERD_BETA.mmd'), 'erDiagram\n', 'utf8');
  assert.equal(erdMain(['--dir', dir, '--check'], () => {}), 1);
});

test('loadModel exposes ERD.mmd only when the file exists', () => {
  const dir = writeDir();
  for (const name of ['screen_catalog.json', 'implementation_backlog.json', 'traceability.json', 'test_cases.json']) {
    writeFileSync(join(dir, name), '[]', 'utf8');
  }
  writeFileSync(join(dir, ENGINEERING_FILES.openapi), '{}', 'utf8');
  writeFileSync(join(dir, ENGINEERING_FILES.dictionary), JSON.stringify({ entities: {} }), 'utf8');
  assert.equal(loadModel(dir).erd, undefined);
  erdMain(['--dir', dir], () => {});
  assert.ok(loadModel(dir).erd.startsWith('erDiagram'));
});

test('the real schema renders one entity per table', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../../03_Engineering/schema_reference.sql', import.meta.url)), 'utf8');
  const tables = [...parseSql(sql).tables.keys()];
  const { full, entityCount } = renderErd(sql);
  assert.equal(entityCount, tables.length);
  assert.deepEqual([...erdEntities(full)].sort(), [...tables].sort());
});
