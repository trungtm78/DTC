import { finding } from './finding.mjs';
import { parseSql } from '../sql.mjs';
import { erdEntities } from '../erd.mjs';

// ERD.mmd is generated from schema_reference.sql (npm run erd); every table needs an entity in it.
export function checkErd(model) {
  if (model.erd === undefined) return [];
  const entities = erdEntities(model.erd);
  return [...parseSql(model.sql).tables.keys()]
    .filter((table) => !entities.has(table))
    .map((table) => finding('ERD_ENTITY_MISSING', { table }));
}
