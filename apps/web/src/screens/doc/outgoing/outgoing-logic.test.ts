import { ApiError } from '@machvon/api-client';
import { describe, expect, it } from 'vitest';
import { describeProblem } from './problems';
import { canStartSigning, displayNumber, expectedSymbol, isOpenSession, issueDateProblem, minutesLeft, numberingSteps, openSessionOf, signingChecks, vietnamDateOf } from './rules';
import { toDetail, toPage } from './types';

const NOW = new Date('2026-10-23T03:00:00Z');
const session = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  role: 'LEADER',
  status: 'AWAITING_SIGNER',
  adapter_code: 'MOCK',
  adapter_status: 'MOCK',
  expires_at: '2026-10-23T03:10:00Z',
  created_at: '2026-10-23T03:00:00Z',
  version: 1,
  error_code: null,
  ...overrides,
});
const detail = (overrides: Record<string, unknown> = {}) =>
  toDetail({
    id: 'd1',
    document_id: 'x1',
    title: 'Decision',
    status: 'SUBMITTED',
    signer_user_id: '00000000-0000-4000-8000-000000000001',
    signer_title: 'Chairman',
    current_version_id: 'v1',
    version: 1,
    versions: [{ id: 'v1', version: 1, stage: 'RENDERED_FINAL', page_count: 2, scan_status: 'CLEAN', created_at: '2026-10-23T02:00:00Z' }],
    certificates: [{ id: 'c1', kind: 'PERSONAL', subject_dn: 'CN=A', valid_until: '2027-01-01T00:00:00Z', status: 'Active' }],
    sessions: [],
    ...overrides,
  });

describe('signing checklist (DOC-05)', () => {
  it('is ready to start when the document waits, a certificate is active and no session is open', () => {
    const d = detail();
    expect(canStartSigning(d, NOW)).toBe(true);
    expect(signingChecks(d, NOW).map((check) => [check.id, check.state])).toEqual([
      ['viewer', 'pass'],
      ['box', 'none'],
      ['certificate', 'pass'],
      ['session', 'none'],
      ['adapter', 'none'],
      ['reject', 'none'],
    ]);
  });

  it('shows an open session, and an expired one as an error', () => {
    const open = detail({ sessions: [session()] });
    expect(openSessionOf(open, 'LEADER', NOW)?.id).toBe('s1');
    expect(canStartSigning(open, NOW)).toBe(false);
    expect(signingChecks(open, NOW).find((check) => check.id === 'session')?.state).toBe('pass');
    expect(minutesLeft('2026-10-23T03:10:00Z', NOW)).toBe(10);
    expect(minutesLeft('2026-10-23T02:00:00Z', NOW)).toBe(0);
    const late = new Date('2026-10-23T03:30:00Z');
    expect(isOpenSession(open.sessions[0]!, late)).toBe(false);
    expect(signingChecks(open, late).find((check) => check.id === 'session')?.state).toBe('fail');
  });

  it('flags a missing file, an inactive certificate, a failed attempt and an unverified adapter', () => {
    const d = detail({
      current_version_id: null,
      certificates: [{ id: 'c1', kind: 'PERSONAL', subject_dn: 'CN=A', valid_until: '2027-01-01T00:00:00Z', status: 'Suspended' }],
      sessions: [session({ status: 'EXPIRED', error_code: 'SIGNING_SESSION_EXPIRED', adapter_status: 'MISSING' })],
    });
    const states = Object.fromEntries(signingChecks(d, NOW).map((check) => [check.id, check.state]));
    expect(states).toMatchObject({ viewer: 'fail', certificate: 'fail', adapter: 'fail', reject: 'review' });
    expect(canStartSigning(d, NOW)).toBe(false);
  });

  it('marks the box signed once the leader signed', () => {
    expect(signingChecks(detail({ status: 'SIGNED', leader_signed_at: '2026-10-23T03:00:00Z' }), NOW)[1]?.state).toBe('pass');
    expect(signingChecks(detail({ signer_title: null, signer_user_id: null }), NOW)[1]?.state).toBe('fail');
  });
});

describe('numbering steps and symbols (DOC-06)', () => {
  it('moves the current step from the number to the seal', () => {
    expect(numberingSteps('SUBMITTED').every((step) => step.state === 'waiting' || step.id === 'void')).toBe(true);
    expect(numberingSteps('SIGNED').filter((step) => step.state === 'current').map((step) => step.id)).toEqual(['queue', 'register', 'date', 'symbol', 'status']);
    expect(numberingSteps('NUMBERED').find((step) => step.id === 'seal')?.state).toBe('current');
    expect(numberingSteps('SEALED').find((step) => step.id === 'seal')?.state).toBe('done');
  });

  it('builds the symbol the way the server does, or nothing while a part is missing', () => {
    const parts = { number: 5, type: 'QD', agency: 'UBND', unit: '' };
    expect(expectedSymbol('{number}/{type}-{agency}', parts)).toBe('05/QD-UBND');
    expect(expectedSymbol('{number}/{type}-{unit}', parts)).toBeUndefined();
    expect(expectedSymbol('{number}/{type}', { ...parts, type: null })).toBeUndefined();
    expect(expectedSymbol('{number}/{x}', parts)).toBeUndefined();
    expect(displayNumber(12)).toBe('12');
  });

  it('judges the issue date in the Vietnam calendar', () => {
    expect(vietnamDateOf(new Date('2026-10-22T18:00:00Z'))).toBe('2026-10-23');
    expect(issueDateProblem('', '2026-10-23', null)).toBe('required');
    expect(issueDateProblem('2026-13-45', '2026-10-23', null)).toBe('required');
    expect(issueDateProblem('2026-02-31', '2026-10-23', null)).toBe('required');
    expect(issueDateProblem('2026-10-24', '2026-10-23', null)).toBe('future');
    expect(issueDateProblem('2026-10-01', '2026-10-23', '2026-10-05')).toBe('beforeSigning');
    expect(issueDateProblem('2026-10-23', '2026-10-23', '2026-10-05')).toBeUndefined();
  });
});

describe('mapping and problems', () => {
  it('reads unknown shapes as empty rows', () => {
    expect(toPage(null)).toEqual({ items: [], nextCursor: undefined });
    expect(toDetail('x').sessions).toEqual([]);
    expect(toDetail({ status: 'WEIRD', sessions: [{ role: 'X', status: 'Y' }] }).status).toBe('OTHER');
  });

  it('names a refused command in the words of the screen, and an open session by context', () => {
    const error = (code: string) => new ApiError({ status: 409, code, detail: undefined, correlationId: undefined } as never);
    expect(describeProblem(error('VERSION_CONFLICT'), 'start').reason).toBe('conflict');
    expect(describeProblem(error('SIGNING_SESSION_OPEN'), 'start').reason).toBe('sessionOpen');
    expect(describeProblem(error('SIGNING_SESSION_OPEN'), 'complete').reason).toBe('pending');
    expect(describeProblem(error('SOMETHING_NEW'), 'number').reason).toBe('general');
    expect(describeProblem(new Error('x'), 'number').reason).toBe('general');
  });
});
