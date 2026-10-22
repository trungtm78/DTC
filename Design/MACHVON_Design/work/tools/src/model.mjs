import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// File names inside 03_Engineering; JSON/SQL/OpenAPI are the single source of truth (decision D3).
export const ENGINEERING_FILES = {
  screens: 'screen_catalog.json',
  backlog: 'implementation_backlog.json',
  trace: 'traceability.json',
  tests: 'test_cases.json',
  openapi: 'openapi.json',
  dictionary: 'data_dictionary.json',
  sql: 'schema_reference.sql',
  nonFunctional: 'nonfunctional_requirements.json',
  decisions: 'implementation_decisions.json',
};

function readJson(dir, name) {
  return JSON.parse(readFileSync(join(dir, name), 'utf8'));
}

function readOptionalJson(dir, name, fallback) {
  return existsSync(join(dir, name)) ? readJson(dir, name) : fallback;
}

export function loadModel(dir) {
  return {
    screens: readJson(dir, ENGINEERING_FILES.screens),
    backlog: readJson(dir, ENGINEERING_FILES.backlog),
    trace: readJson(dir, ENGINEERING_FILES.trace),
    tests: readJson(dir, ENGINEERING_FILES.tests),
    openapi: readJson(dir, ENGINEERING_FILES.openapi),
    entities: readJson(dir, ENGINEERING_FILES.dictionary).entities,
    sql: readFileSync(join(dir, ENGINEERING_FILES.sql), 'utf8'),
    nonFunctional: readOptionalJson(dir, ENGINEERING_FILES.nonFunctional, []),
    decisions: readOptionalJson(dir, ENGINEERING_FILES.decisions, []),
  };
}
