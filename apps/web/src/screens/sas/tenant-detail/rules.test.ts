import { describe, expect, it } from 'vitest';
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH, SUSPENSION_REASON_CODES, accessPolicyOf, isReasonCode, isReasonValid, lifecycleActions } from './rules';

describe('the policy a suspension reason implies', () => {
  it('blocks all access for a security incident and leaves read and export for every other reason', () => {
    expect(accessPolicyOf('SECURITY_INCIDENT')).toBe('NO_ACCESS');
    for (const code of SUSPENSION_REASON_CODES.filter((candidate) => candidate !== 'SECURITY_INCIDENT')) expect(accessPolicyOf(code)).toBe('READ_ONLY_EXPORT');
  });

  it('recognises the five codes of the contract and nothing else', () => {
    expect(SUSPENSION_REASON_CODES).toHaveLength(5);
    expect(SUSPENSION_REASON_CODES.every(isReasonCode)).toBe(true);
    expect(isReasonCode('BORED')).toBe(false);
  });
});

describe('isReasonValid', () => {
  it('accepts 10 to 2000 characters after trimming and refuses anything outside', () => {
    expect(isReasonValid('x'.repeat(REASON_MIN_LENGTH))).toBe(true);
    expect(isReasonValid('x'.repeat(REASON_MIN_LENGTH - 1))).toBe(false);
    expect(isReasonValid(`   ${'x'.repeat(REASON_MIN_LENGTH - 1)}   `)).toBe(false);
    expect(isReasonValid('x'.repeat(REASON_MAX_LENGTH))).toBe(true);
    expect(isReasonValid('x'.repeat(REASON_MAX_LENGTH + 1))).toBe(false);
    expect(isReasonValid('')).toBe(false);
  });
});

describe('lifecycleActions', () => {
  it('offers suspend for Active and resume for Suspended to a person who manages tenants, and nothing to anyone else', () => {
    expect(lifecycleActions('Active', true)).toEqual(['suspend']);
    expect(lifecycleActions('Suspended', true)).toEqual(['resume']);
    for (const status of ['Requested', 'Provisioning', 'Failed', 'Offboarding', 'Archived', 'Unknown']) expect(lifecycleActions(status, true)).toEqual([]);
    for (const status of ['Active', 'Suspended']) expect(lifecycleActions(status, false)).toEqual([]);
  });
});
