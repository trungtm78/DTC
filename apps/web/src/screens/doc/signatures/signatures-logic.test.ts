import { ApiError } from '@machvon/api-client';
import { describe, expect, it } from 'vitest';
import { PILL_CLASS, checksOf } from './checks';
import { describeProblem } from './problems';
import { toReport, toSignature, toVersion, toVersionPage } from './types';
import type { SignatureRow } from './types';

const signature = (overrides: Partial<SignatureRow> = {}): SignatureRow => ({
  index: 0,
  role: 'LEADER',
  verificationNo: 1,
  subjectDn: 'CN=Nguyen Van A',
  issuerDn: 'CN=Test CA',
  serial: '0A',
  trustRegime: 'PUBLIC_CA',
  profile: 'PADES_B_T',
  docmdpLevel: null,
  signedAt: '2026-10-23T08:00:00.000Z',
  timestampAt: '2026-10-23T08:00:00.000Z',
  status: 'VALID',
  chainStatus: 'TRUSTED',
  revocationStatus: 'GOOD',
  incrementalChangesAllowed: true,
  findings: [],
  verifiedAt: '2026-10-23T09:00:00.000Z',
  registeredCertificateId: null,
  ...overrides,
});

const stateOf = (rows: SignatureRow[], overall: 'VALID' | 'INVALID' | 'INDETERMINATE', id: string): string | undefined => checksOf(overall, rows).find((check) => check.id === id)?.state;

describe('checksOf', () => {
  it('passes every check for a fully valid verification', () => {
    expect(checksOf('VALID', [signature()]).map((check) => check.state)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
  });

  it('has nothing to check without signatures, and the conclusion follows the overall result', () => {
    expect(checksOf('INDETERMINATE', []).map((check) => check.state)).toEqual(['none', 'none', 'none', 'none', 'none', 'review']);
  });

  it('fails the first check for a broken signature or a bad order', () => {
    for (const code of ['DIGEST_MISMATCH', 'BYTE_RANGE_INVALID', 'SIGNING_ORDER_INVALID', 'ALGORITHM_NOT_ALLOWED']) {
      expect(stateOf([signature({ findings: [code], status: 'INVALID' })], 'INVALID', 'order')).toBe('fail');
    }
  });

  it('fails an untrusted chain, asks for review of an incomplete one and marks an unchecked one', () => {
    expect(stateOf([signature({ chainStatus: 'UNTRUSTED' })], 'INVALID', 'chain')).toBe('fail');
    expect(stateOf([signature({ chainStatus: 'TRUSTED', findings: ['CHAIN_UNTRUSTED'] })], 'INVALID', 'chain')).toBe('fail');
    expect(stateOf([signature({ chainStatus: 'INCOMPLETE' })], 'INDETERMINATE', 'chain')).toBe('review');
    expect(stateOf([signature({ chainStatus: 'NOT_CHECKED' })], 'INVALID', 'chain')).toBe('none');
  });

  it('reads the revocation of all signatures: revoked fails, unknown needs review, not asked is not checked', () => {
    expect(stateOf([signature(), signature({ revocationStatus: 'REVOKED' })], 'INVALID', 'revocation')).toBe('fail');
    expect(stateOf([signature({ revocationStatus: 'UNKNOWN' })], 'INDETERMINATE', 'revocation')).toBe('review');
    expect(stateOf([signature({ revocationStatus: 'NOT_CHECKED' })], 'VALID', 'revocation')).toBe('none');
    expect(stateOf([signature(), signature({ revocationStatus: 'NOT_CHECKED' })], 'VALID', 'revocation')).toBe('none');
  });

  it('fails changes outside the allowed set and leaves an unlocated signature unchecked', () => {
    expect(stateOf([signature({ incrementalChangesAllowed: false })], 'INVALID', 'incremental')).toBe('fail');
    expect(stateOf([signature({ incrementalChangesAllowed: null })], 'INVALID', 'incremental')).toBe('none');
  });

  it('fails an invalid timestamp or an expired certificate and asks for review when the time is unproven', () => {
    expect(stateOf([signature({ findings: ['TIMESTAMP_INVALID'] })], 'INVALID', 'timestamp')).toBe('fail');
    expect(stateOf([signature({ findings: ['CERTIFICATE_EXPIRED_AT_SIGNING'] })], 'INVALID', 'timestamp')).toBe('fail');
    expect(stateOf([signature({ findings: ['SIGNING_TIME_UNPROVEN'], timestampAt: null })], 'INDETERMINATE', 'timestamp')).toBe('review');
    expect(stateOf([signature({ timestampAt: null })], 'VALID', 'timestamp')).toBe('none');
  });

  it('maps the conclusion and gives every state a pill class', () => {
    expect(stateOf([signature()], 'INVALID', 'conclusion')).toBe('fail');
    expect(stateOf([signature()], 'INDETERMINATE', 'conclusion')).toBe('review');
    expect(Object.keys(PILL_CLASS).sort()).toEqual(['fail', 'none', 'pass', 'review']);
  });
});

describe('describeProblem', () => {
  const problem = (code: string, status = 422) => describeProblem(new ApiError({ status, code, correlationId: 'c' }));

  it('names the reasons a verification can fail', () => {
    expect(problem('DOCUMENT_VERSION_NOT_PDF').reason).toBe('notPdf');
    expect(problem('SCAN_PENDING', 409).reason).toBe('scanPending');
    expect(problem('VALIDATION_FAILED').reason).toBe('invalid');
    expect(problem('RESOURCE_NOT_FOUND', 404).reason).toBe('notFound');
    expect(problem('SCOPE_DENIED', 403).reason).toBe('denied');
    expect(problem('SESSION_EXPIRED', 401).reason).toBe('session');
    expect(problem('SOMETHING_ELSE', 500).reason).toBe('general');
    expect(describeProblem(new Error('x')).reason).toBe('general');
  });
});

describe('response parsers', () => {
  it('reads a report and falls back to safe values for what is missing or unknown', () => {
    const report = toReport({ version_id: 'v', overall: 'WHATEVER', signatures: [{ index: 2, role: 'NOBODY', status: 'VALID', chain_status: 'TRUSTED', findings: ['A', 7], docmdp_level: 2, incremental_changes_allowed: true }, 'broken'] });
    expect(report).toMatchObject({ versionId: 'v', overall: 'INDETERMINATE' });
    expect(report.signatures[0]).toMatchObject({ index: 2, role: 'EXTERNAL', status: 'VALID', chainStatus: 'TRUSTED', findings: ['A'], docmdpLevel: 2, incrementalChangesAllowed: true, trustRegime: null, profile: null });
    expect(report.signatures[1]).toMatchObject({ index: 0, status: 'INDETERMINATE', chainStatus: 'NOT_CHECKED', revocationStatus: 'NOT_CHECKED', incrementalChangesAllowed: null });
    expect(toReport(null)).toEqual({ versionId: '', overall: 'INDETERMINATE', signatures: [] });
    expect(toSignature(undefined).role).toBe('EXTERNAL');
  });

  it('reads versions and pages of versions', () => {
    const page = toVersionPage({ items: [{ id: 'a', document_id: 'd', version: 2, stage: 'LEADER_SIGNED', mime: 'application/pdf', page_count: 3, checksum: 'abc', scan_status: 'CLEAN', created_at: '2026-01-01T00:00:00Z' }], next_cursor: 'next' });
    expect(page.nextCursor).toBe('next');
    expect(page.items[0]).toMatchObject({ id: 'a', version: 2, stage: 'LEADER_SIGNED', pageCount: 3 });
    expect(toVersionPage(undefined)).toEqual({ items: [], nextCursor: null });
    expect(toVersion('x').id).toBe('');
  });
});
