import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const MODULE_SPEC_FILE = /^[A-Z]+\.md$/;

// Module specs live in 01_Documents/05_modules/<CODE>.md; files starting with "_" are templates.
export function loadModuleSpecs(specsDir) {
  if (!existsSync(specsDir)) return undefined;
  const specs = {};
  for (const name of readdirSync(specsDir).filter((file) => MODULE_SPEC_FILE.test(file))) {
    specs[basename(name, '.md')] = readFileSync(join(specsDir, name), 'utf8');
  }
  return specs;
}

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
  errorCodes: 'error_codes.json',
  plan: 'implementation_plan.json',
  legalLedger: 'legal_confirmation_ledger.json',
  navigation: 'navigation_architecture.json',
  erd: 'ERD.mmd',
};

function readJson(dir, name) {
  return JSON.parse(readFileSync(join(dir, name), 'utf8'));
}

function readOptionalJson(dir, name, fallback) {
  return existsSync(join(dir, name)) ? readJson(dir, name) : fallback;
}

function readOptionalText(dir, name) {
  return existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined;
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
    errorCodes: readOptionalJson(dir, ENGINEERING_FILES.errorCodes, undefined),
    plan: readOptionalJson(dir, ENGINEERING_FILES.plan, undefined),
    legalLedger: readOptionalJson(dir, ENGINEERING_FILES.legalLedger, undefined),
    navigation: readOptionalJson(dir, ENGINEERING_FILES.navigation, undefined),
    erd: readOptionalText(dir, ENGINEERING_FILES.erd),
  };
}
