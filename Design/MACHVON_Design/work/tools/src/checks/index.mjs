import { checkUniqueIds } from './unique-ids.mjs';
import { checkScreenLinks } from './screen-links.mjs';
import { checkTestReferences } from './test-references.mjs';
import { checkTestQuality } from './test-quality.mjs';
import { checkRequirementCoverage } from './requirement-coverage.mjs';
import { checkOpenApi } from './openapi.mjs';
import { checkDataModel } from './data-model.mjs';
import { checkErd } from './erd.mjs';
import { checkModuleSpecs } from './module-specs.mjs';
import { checkRlsConvention } from './rls.mjs';
import { checkErrorCodes } from './error-codes.mjs';
import { checkErrorCodeRegistered } from './error-code-registered.mjs';
import { checkNavigation } from './navigation.mjs';
import { checkPlan } from '../plan.mjs';

const CHECKS = [
  checkModuleSpecs,
  checkRlsConvention,
  checkErrorCodes,
  checkErrorCodeRegistered,
  checkPlan,
  checkUniqueIds,
  checkScreenLinks,
  checkNavigation,
  checkTestReferences,
  checkTestQuality,
  checkRequirementCoverage,
  checkOpenApi,
  checkDataModel,
  checkErd,
];

export function runChecks(model, options = {}) {
  return CHECKS.flatMap((check) => check(model, options));
}
