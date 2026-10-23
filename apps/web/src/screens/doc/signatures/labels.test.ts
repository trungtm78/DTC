import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n';
import en from '../../../i18n/en.json';
import vi from '../../../i18n/vi.json';
import { CHECK_IDS } from './checks';
import type { CheckState } from './checks';
import { chainLabel, checkHint, checkTitle, findingLabel, overallLabel, problemMessage, profileLabel, regimeLabel, revocationLabel, roleLabel, stateLabel } from './labels';
import { CHAIN_STATUSES, OVERALL_STATUSES, PROFILES, REGIMES, REVOCATION_STATUSES, ROLES } from './types';
import type { ProblemReason } from './problems';

const KNOWN_FINDINGS = [
  'BYTE_RANGE_INVALID',
  'SIGNATURE_MALFORMED',
  'DIGEST_MISMATCH',
  'SIGNATURE_INVALID',
  'ALGORITHM_NOT_ALLOWED',
  'SIGNER_CERTIFICATE_MISMATCH',
  'CHAIN_UNTRUSTED',
  'CHAIN_INCOMPLETE',
  'CERTIFICATE_EXPIRED_AT_SIGNING',
  'CERTIFICATE_REVOKED',
  'REVOCATION_UNKNOWN',
  'INCREMENTAL_CHANGES_NOT_ALLOWED',
  'SIGNING_TIME_UNPROVEN',
  'TIMESTAMP_INVALID',
  'SIGNING_ORDER_INVALID',
];
const STATES: CheckState[] = ['pass', 'review', 'fail', 'none'];
const PROBLEMS: ProblemReason[] = ['notPdf', 'scanPending', 'invalid', 'notFound', 'denied', 'session', 'general'];

describe.each(['vi', 'en'] as const)('the labels of DOC-07 in %s', (locale) => {
  const { t } = createTranslator({ locale, catalogues: { vi, en }, strict: true });

  it('names every check, state, result, role, chain, revocation, regime and profile with text of its own', () => {
    const texts = [
      ...CHECK_IDS.flatMap((id) => [checkTitle(t, id), checkHint(t, id)]),
      ...STATES.map((state) => stateLabel(t, state)),
      ...OVERALL_STATUSES.map((overall) => overallLabel(t, overall)),
      ...ROLES.map((role) => roleLabel(t, role)),
      ...CHAIN_STATUSES.map((status) => chainLabel(t, status)),
      ...REVOCATION_STATUSES.map((status) => revocationLabel(t, status)),
      ...REGIMES.map((regime) => regimeLabel(t, regime)),
      ...PROFILES.map((profile) => profileLabel(t, profile)),
    ];
    expect(texts.every((text) => text !== '' && !text.startsWith('doc.signatureReport.'))).toBe(true);
    expect(new Set(OVERALL_STATUSES.map((overall) => overallLabel(t, overall))).size).toBe(OVERALL_STATUSES.length);
  });

  it('explains every finding the verifier can report, and shows an unknown code as it is', () => {
    for (const code of KNOWN_FINDINGS) expect(findingLabel(t, code)).not.toBe(code);
    expect(findingLabel(t, 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('words every problem', () => {
    for (const reason of PROBLEMS) expect(problemMessage(t, { reason })).not.toMatch(/^doc\.signatureReport\./);
  });
});

describe('the catalogues of DOC-07', () => {
  it('hold the same keys in both languages', () => {
    const keys = (catalogue: Record<string, string>) => Object.keys(catalogue).filter((key) => key.startsWith('doc.signatureReport.')).sort();
    expect(keys(en)).toEqual(keys(vi));
  });
});
