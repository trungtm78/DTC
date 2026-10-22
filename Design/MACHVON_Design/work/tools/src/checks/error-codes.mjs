import { finding } from './finding.mjs';

// Error codes are a contract between API, specs and tests: one canonical spelling per meaning.
// error_codes.json maps alias spellings to the canonical code.

function aliasPattern(alias) {
  return new RegExp(String.raw`\b${alias}\b(?!_)`);
}

function corpora(model) {
  return [
    ...Object.entries(model.moduleSpecs ?? {}).map(([module, text]) => ({ where: `spec ${module}`, text })),
    ...model.tests.map((test) => ({ where: `test ${test.id}`, text: JSON.stringify(test) })),
    { where: 'openapi', text: JSON.stringify(model.openapi) },
  ];
}

export function checkErrorCodes(model) {
  const aliases = model.errorCodes?.aliases;
  if (!aliases) return [];
  return corpora(model).flatMap(({ where, text }) =>
    Object.entries(aliases)
      .filter(([alias]) => aliasPattern(alias).test(text))
      .map(([alias, canonical]) => finding('ERROR_CODE_ALIAS', { alias, canonical, where })),
  );
}
