import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkErrorCodes } from '../src/checks/error-codes.mjs';
import { validModel } from './fixtures.mjs';

const ALIASES = { IDEMPOTENCY_BODY_MISMATCH: 'IDEMPOTENCY_CONFLICT', SELF_APPROVAL_FORBIDDEN: 'SELF_APPROVAL_DENIED' };

function model(overrides = {}) {
  return { ...validModel(), errorCodes: { aliases: ALIASES }, moduleSpecs: {}, ...overrides };
}

test('canonical codes produce no findings', () => {
  const m = model({ moduleSpecs: { PAY: 'Lỗi `IDEMPOTENCY_CONFLICT` và `SELF_APPROVAL_DENIED`.' } });
  assert.deepEqual(checkErrorCodes(m), []);
});

test('an alias in a module spec, a test or the OpenAPI document is reported with its canonical code', () => {
  const m = model({ moduleSpecs: { MOB: 'Trả `IDEMPOTENCY_BODY_MISMATCH` khi đổi nội dung.' } });
  m.tests[0].expected = 'Lỗi SELF_APPROVAL_FORBIDDEN';
  m.openapi.paths['/x'] = { get: { operationId: 'g', 'x-permission': 'p', description: 'IDEMPOTENCY_BODY_MISMATCH' } };
  const findings = checkErrorCodes(m);
  assert.deepEqual(findings.map((f) => f.code), ['ERROR_CODE_ALIAS', 'ERROR_CODE_ALIAS', 'ERROR_CODE_ALIAS']);
  assert.deepEqual(findings.map((f) => f.params.canonical).sort(), ['IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'SELF_APPROVAL_DENIED']);
  assert.deepEqual(findings.map((f) => f.params.where).sort(), ['openapi', 'spec MOB', 'test UI-IAM-01']);
});

test('longer codes that merely start with an alias are not aliases, and the check is skipped without a registry', () => {
  const m = model({ moduleSpecs: { PAY: 'Mã `SELF_APPROVAL_FORBIDDEN_EXTRA` là mã khác.' } });
  assert.deepEqual(checkErrorCodes(m), []);
  assert.deepEqual(checkErrorCodes({ ...validModel(), moduleSpecs: { A: 'IDEMPOTENCY_BODY_MISMATCH' } }), []);
});
