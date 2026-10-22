import { finding } from './finding.mjs';
import { parseSql } from '../sql.mjs';

function isForeignKeyColumn(column) {
  return column.endsWith('_id') && column !== 'tenant_id';
}

function isIndexed(indexes, table, column) {
  return indexes.some((index) => index.table === table && index.columns.includes(column));
}

export function checkDataModel(model) {
  const { tables, rls, indexes } = parseSql(model.sql);
  const findings = [];

  for (const entity of Object.keys(model.entities)) {
    if (!tables.has(entity)) findings.push(finding('ENTITY_WITHOUT_TABLE', { entity }));
  }
  for (const table of tables.values()) {
    if (!(table.name in model.entities)) findings.push(finding('TABLE_WITHOUT_ENTITY', { table: table.name }));
    if (!table.columns.includes('tenant_id')) continue;
    if (!rls.has(table.name)) findings.push(finding('TENANT_TABLE_WITHOUT_RLS', { table: table.name }));
    for (const column of table.columns.filter(isForeignKeyColumn)) {
      if (!isIndexed(indexes, table.name, column)) {
        findings.push(finding('FK_COLUMN_WITHOUT_INDEX', { table: table.name, column }));
      }
    }
  }
  return findings;
}
