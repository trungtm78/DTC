import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkErrorCodeRegistered } from '../src/checks/error-code-registered.mjs';
import { runChecks } from '../src/checks/index.mjs';
import { loadMessages } from '../src/i18n.mjs';
import { validModel } from './fixtures.mjs';

const REGISTRY = {
  canonical: { VERSION_CONFLICT: 'If-Match did not match (409).' },
  registry: { AVC_BLOCKED: { status: 422 } },
  aliases: { SELF_APPROVAL_FORBIDDEN: 'SELF_APPROVAL_DENIED' },
};

function model({ errorCodes = REGISTRY, then = 'returns 409 VERSION_CONFLICT', declared = ['AVC_BLOCKED'] } = {}) {
  const base = validModel();
  base.openapi.paths['/reports/{id}/submit'].post['x-error-codes'] = declared;
  return {
    ...base,
    errorCodes,
    plan: { stories: [{ id: 'ST-1', module: 'DIS', acceptance: [{ test_id: 'UI-DIS-01', then }] }] },
  };
}

test('registered canonical and registry codes in the plan and the OpenAPI document pass', () => {
  assert.deepEqual(checkErrorCodeRegistered(model()), []);
});

test('a plan code missing from the registry is reported with the source it came from', () => {
  const findings = checkErrorCodeRegistered(model({ then: 'returns 422 ACCEPTANCE_ALREADY_CLAIMED' }));
  assert.deepEqual(findings.map((f) => [f.code, f.severity, f.params]), [
    ['ERROR_CODE_UNREGISTERED', 'error', { code: 'ACCEPTANCE_ALREADY_CLAIMED', where: 'plan' }],
  ]);
});

test('an OpenAPI x-error-codes entry or described code missing from the registry is reported once with every source', () => {
  const m = model({ declared: ['NEW_OPENAPI_CODE'], then: 'returns 422 NEW_OPENAPI_CODE' });
  m.openapi.paths['/resources/project'].get.description = 'Fails with 409 OTHER_NEW_CODE';
  const findings = checkErrorCodeRegistered(m);
  assert.deepEqual(findings.map((f) => f.params), [
    { code: 'NEW_OPENAPI_CODE', where: 'openapi, plan' },
    { code: 'OTHER_NEW_CODE', where: 'openapi' },
  ]);
});

test('an alias is not a registered spelling', () => {
  const findings = checkErrorCodeRegistered(model({ then: 'returns 403 SELF_APPROVAL_FORBIDDEN' }));
  assert.equal(findings.length, 1);
});

test('state names that no status ties to an error are not error codes', () => {
  assert.deepEqual(checkErrorCodeRegistered(model({ then: 'the request moves to SENT_TREASURY and 200 ACTIVE' })), []);
});

test('the check is skipped when the package has no structured registry', () => {
  assert.deepEqual(checkErrorCodeRegistered(model({ errorCodes: { canonical: {}, aliases: {} }, then: '422 UNKNOWN_CODE' })), []);
  assert.deepEqual(checkErrorCodeRegistered({ ...model(), errorCodes: undefined }), []);
});

test('the check runs inside runChecks and has a message in every locale', () => {
  const findings = runChecks({ ...model({ declared: ['NEW_OPENAPI_CODE'] }), plan: undefined, moduleSpecs: {} }).filter(
    (f) => f.code === 'ERROR_CODE_UNREGISTERED',
  );
  assert.equal(findings.length, 1);
  for (const locale of ['en', 'vi']) {
    assert.match(loadMessages(locale)[findings[0].messageKey], /\{code\}/);
  }
});
