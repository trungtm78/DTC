import { describe, expect, it } from 'vitest';
import vi_ from '../../../i18n/vi.json';
import { actionLabel, consequenceLabel, editionLabel, fieldProblemMessage, problemMessage, signatureLabel, signatureTone, statusLabel } from './labels';
import type { ProblemReason } from './problems';
import type { FieldProblem } from './rules';
import { EDITIONS, LICENSE_STATUSES, SIGNATURE_CHECKS } from './types';

const catalogue = vi_ as Record<string, string>;
// A translator that reads the real catalogue and fills the placeholders, so a missing key shows up as the key itself.
const t = (key: string, params: Record<string, string | number> = {}): string => (catalogue[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));

const REASONS: readonly ProblemReason[] = ['rangeInvalid', 'tenantMismatch', 'tenantState', 'signingKey', 'stateInvalid', 'conflict', 'invalid', 'fieldNotAllowed', 'notFound', 'denied', 'stepUp', 'session', 'general'];
const FIELD_PROBLEMS: readonly FieldProblem[] = ['required', 'uuid', 'choice', 'seats', 'date', 'window', 'grace', 'past', 'lease', 'entitlement'];

const distinct = (values: readonly string[]): void => {
  expect(values.every((value) => value !== '' && !value.startsWith('sas.'))).toBe(true);
  expect(new Set(values).size).toBe(values.length);
};

describe('the words of the license screens', () => {
  it('has a distinct catalogue text for every state, edition and signature result', () => {
    distinct(LICENSE_STATUSES.map((status) => statusLabel(t, status)));
    distinct(EDITIONS.map((edition) => editionLabel(t, edition)));
    distinct(SIGNATURE_CHECKS.map((check) => signatureLabel(t, check)));
  });

  it('writes an edition or a signature result it does not know as the server wrote it', () => {
    expect(editionLabel(t, 'GOLD')).toBe('GOLD');
    expect(signatureLabel(t, 'NEW_CHECK')).toBe('NEW_CHECK');
  });

  it('is green only for a signature that is valid', () => {
    expect(SIGNATURE_CHECKS.map(signatureTone)).toEqual(['ok', 'red', 'red', 'red', 'red']);
  });

  it('has a distinct message for every reason a command can fail, naming the version of a conflict', () => {
    const messages = REASONS.map((reason) => problemMessage(t, { reason, field: undefined, currentVersion: 9 }));
    distinct(messages);
    expect(problemMessage(t, { reason: 'conflict', field: undefined, currentVersion: 9 })).toContain('9');
    expect(problemMessage(t, { reason: 'conflict', field: undefined, currentVersion: undefined })).not.toContain('{version}');
  });

  it('has a distinct message for every reason a field of the issue form can be refused', () => {
    distinct(FIELD_PROBLEMS.map((problem) => fieldProblemMessage(t, problem)));
  });

  it('names each action and what it means for the data of the tenant', () => {
    distinct((['suspend', 'reinstate', 'revoke'] as const).map((action) => actionLabel(t, action)));
    distinct((['suspend', 'reinstate', 'revoke'] as const).map((action) => consequenceLabel(t, action)));
  });
});
