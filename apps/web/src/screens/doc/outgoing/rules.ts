import type { DocType } from '../registers/types';
import type { CertificateOption, DocumentStatus, OutgoingDetail, SessionRole, SessionRow, VersionRow } from './types';

/** `pass` is in order, `review` can be done but needs a look, `fail` blocks, `none` has nothing to show yet. */
export type CheckState = 'pass' | 'review' | 'fail' | 'none';

export const SIGNING_CHECK_IDS = ['viewer', 'box', 'certificate', 'session', 'adapter', 'reject'] as const;
export type SigningCheckId = (typeof SIGNING_CHECK_IDS)[number];

/** What a row of the signing checklist says, as data; the words come from the catalogue (`labels.ts`). */
export type Fact =
  | { kind: 'viewerReady'; version: number; pages: number; stage: string }
  | { kind: 'viewerMissing' }
  | { kind: 'viewerStage'; stage: string }
  | { kind: 'boxUnnamed' }
  | { kind: 'boxPending'; signer: string }
  | { kind: 'boxSigned'; at: string }
  | { kind: 'certActive'; subject: string; until: string }
  | { kind: 'certNone' }
  | { kind: 'certInactive'; subject: string; status: string }
  | { kind: 'sessionOpen'; until: string }
  | { kind: 'sessionExpired'; at: string }
  | { kind: 'sessionNone' }
  | { kind: 'sessionDone'; at: string }
  | { kind: 'adapterLine'; adapter: string; status: string }
  | { kind: 'adapterNone' }
  | { kind: 'rejectReason'; reason: string }
  | { kind: 'rejectNone' };

export interface SigningCheck {
  id: SigningCheckId;
  state: CheckState;
  fact: Fact;
}

const OPEN_SESSION_STATUSES: readonly string[] = ['CREATED', 'HASH_READY', 'AWAITING_SIGNER'];
const FINAL_STAGE = 'RENDERED_FINAL';
const SHORT_ID = 8;

/** A session that still waits for its signer: not ended and not past its time. */
export function isOpenSession(session: SessionRow, now: Date): boolean {
  return OPEN_SESSION_STATUSES.includes(session.status) && new Date(session.expiresAt).getTime() > now.getTime();
}

export function openSessionOf(detail: OutgoingDetail, role: SessionRole, now: Date): SessionRow | undefined {
  return detail.sessions.find((session) => session.role === role && isOpenSession(session, now));
}

/** The newest session of the role (the list comes newest first). */
export function lastSessionOf(detail: OutgoingDetail, role: SessionRole): SessionRow | undefined {
  return detail.sessions.find((session) => session.role === role);
}

/** Whole minutes left until `expiresAt`, never below zero. */
export function minutesLeft(expiresAt: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 60_000));
}

export function currentVersion(detail: OutgoingDetail): VersionRow | undefined {
  return detail.versions.find((version) => version.id === detail.currentVersionId);
}

/** The Active certificates a role may sign with, the one that ends last first. */
export function activeCertificates(detail: OutgoingDetail, kind: CertificateOption['kind']): CertificateOption[] {
  return detail.certificates.filter((certificate) => certificate.kind === kind && certificate.status === 'Active').sort((left, right) => right.validUntil.localeCompare(left.validUntil));
}

const shortId = (id: string | null): string => (id === null ? '' : id.slice(0, SHORT_ID));

export function signerOf(detail: OutgoingDetail): string {
  return detail.signerTitle ?? shortId(detail.signerUserId);
}

function viewerCheck(detail: OutgoingDetail): SigningCheck {
  const version = currentVersion(detail);
  if (version === undefined) return { id: 'viewer', state: 'fail', fact: { kind: 'viewerMissing' } };
  if (detail.status === 'SUBMITTED' && version.stage !== FINAL_STAGE) return { id: 'viewer', state: 'review', fact: { kind: 'viewerStage', stage: version.stage } };
  return { id: 'viewer', state: version.scanStatus === 'CLEAN' ? 'pass' : 'review', fact: { kind: 'viewerReady', version: version.version, pages: version.pageCount, stage: version.stage } };
}

function boxCheck(detail: OutgoingDetail): SigningCheck {
  if (detail.leaderSignedAt !== null) return { id: 'box', state: 'pass', fact: { kind: 'boxSigned', at: detail.leaderSignedAt } };
  const signer = signerOf(detail);
  return signer === '' ? { id: 'box', state: 'fail', fact: { kind: 'boxUnnamed' } } : { id: 'box', state: 'none', fact: { kind: 'boxPending', signer } };
}

function certificateCheck(detail: OutgoingDetail, chosen: CertificateOption | undefined): SigningCheck {
  const personal = detail.certificates.filter((certificate) => certificate.kind === 'PERSONAL');
  const pick = chosen ?? activeCertificates(detail, 'PERSONAL')[0] ?? personal[0];
  if (pick === undefined) return { id: 'certificate', state: 'fail', fact: { kind: 'certNone' } };
  if (pick.status !== 'Active') return { id: 'certificate', state: 'fail', fact: { kind: 'certInactive', subject: pick.subjectDn, status: pick.status } };
  return { id: 'certificate', state: 'pass', fact: { kind: 'certActive', subject: pick.subjectDn, until: pick.validUntil } };
}

function sessionCheck(detail: OutgoingDetail, now: Date): SigningCheck {
  const open = openSessionOf(detail, 'LEADER', now);
  if (open !== undefined) return { id: 'session', state: 'pass', fact: { kind: 'sessionOpen', until: open.expiresAt } };
  const last = lastSessionOf(detail, 'LEADER');
  if (last === undefined) return { id: 'session', state: 'none', fact: { kind: 'sessionNone' } };
  if (last.status === 'EMBEDDED') return { id: 'session', state: 'pass', fact: { kind: 'sessionDone', at: last.createdAt } };
  return { id: 'session', state: 'fail', fact: { kind: 'sessionExpired', at: last.expiresAt } };
}

function adapterCheck(detail: OutgoingDetail): SigningCheck {
  const last = lastSessionOf(detail, 'LEADER');
  if (last === undefined) return { id: 'adapter', state: 'none', fact: { kind: 'adapterNone' } };
  const state: CheckState = last.adapterStatus === 'VERIFIED' ? 'pass' : last.adapterStatus === 'MISSING' ? 'fail' : 'review';
  return { id: 'adapter', state, fact: { kind: 'adapterLine', adapter: last.adapterCode, status: last.adapterStatus } };
}

function rejectCheck(detail: OutgoingDetail): SigningCheck {
  const failed = detail.sessions.find((session) => session.role === 'LEADER' && session.errorCode !== null);
  return failed === undefined || failed.errorCode === null
    ? { id: 'reject', state: 'none', fact: { kind: 'rejectNone' } }
    : { id: 'reject', state: 'review', fact: { kind: 'rejectReason', reason: failed.errorCode } };
}

/** The six rows of the leader signing checklist (DOC-05), in the order of the mockup. */
export function signingChecks(detail: OutgoingDetail, now: Date, chosenCertificate?: CertificateOption): SigningCheck[] {
  return [viewerCheck(detail), boxCheck(detail), certificateCheck(detail, chosenCertificate), sessionCheck(detail, now), adapterCheck(detail), rejectCheck(detail)];
}

/** Whether the screen offers to open a signing session: the document waits for the leader, nothing is open and a certificate can sign. */
export function canStartSigning(detail: OutgoingDetail, now: Date): boolean {
  return detail.status === 'SUBMITTED' && openSessionOf(detail, 'LEADER', now) === undefined && activeCertificates(detail, 'PERSONAL').length > 0;
}

export const NUMBERING_STEP_IDS = ['queue', 'register', 'date', 'symbol', 'seal', 'status', 'void'] as const;
export type NumberingStepId = (typeof NUMBERING_STEP_IDS)[number];
export type StepState = 'done' | 'current' | 'waiting';

const AFTER_NUMBERING: readonly DocumentStatus[] = ['NUMBERED', 'SEALED', 'ISSUED'];
const AFTER_SEAL: readonly DocumentStatus[] = ['SEALED', 'ISSUED'];

/** The seven step cards of DOC-06 and where the document is in them. */
export function numberingSteps(status: DocumentStatus): Array<{ id: NumberingStepId; state: StepState }> {
  const waitingForNumber = status === 'SIGNED';
  const numbered = AFTER_NUMBERING.includes(status);
  const sealed = AFTER_SEAL.includes(status);
  const toNumber: StepState = numbered ? 'done' : waitingForNumber ? 'current' : 'waiting';
  return [
    { id: 'queue', state: toNumber },
    { id: 'register', state: toNumber },
    { id: 'date', state: toNumber },
    { id: 'symbol', state: toNumber },
    { id: 'seal', state: sealed ? 'done' : status === 'NUMBERED' ? 'current' : 'waiting' },
    { id: 'status', state: numbered || waitingForNumber ? 'current' : 'waiting' },
    { id: 'void', state: 'waiting' },
  ];
}

export interface SymbolParts {
  number: number;
  type: string | null;
  agency: string;
  unit: string;
}

/** The two digits of a number below ten (BR-DOC-06); the stored value stays an integer. */
export function displayNumber(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

const TOKEN = /\{([^{}]*)\}/g;

/**
 * The symbol a pattern gives before the number is spent (BR-DOC-05: `{number}`, `{type}`, `{agency}`, `{unit}`); undefined
 * when a token has no value yet, so the screen shows a dash instead of a half-built symbol.
 */
export function expectedSymbol(pattern: string, parts: SymbolParts): string | undefined {
  let missing = false;
  const symbol = pattern.replace(TOKEN, (_match, name: string) => {
    const value = name === 'number' ? displayNumber(parts.number) : name === 'type' ? parts.type : name === 'agency' ? parts.agency : name === 'unit' ? parts.unit : null;
    if (value === null || value === '') {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? undefined : symbol;
}

/**
 * The revision of a document type that numbering uses for an issue date (`docTypeFor` on the server): published, in force on
 * the date (the end of the period is exclusive) and, when two periods overlap, the one that started last.
 */
export function docTypeInForce(docTypes: readonly DocType[], code: string, on: string): DocType | undefined {
  return docTypes
    .filter((type) => type.code === code && type.status === 'PUBLISHED' && type.effectiveFrom <= on && (type.effectiveUntil === null || on < type.effectiveUntil))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
}

/** `YYYY-MM-DD` for a date in Asia/Ho_Chi_Minh, the calendar the issue date is kept in. */
export function vietnamDateOf(instant: Date): string {
  return new Date(instant.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/** What is wrong with an issue date, before it leaves the browser: not a date, in the future, or before the leader signed. */
export function issueDateProblem(value: string, today: string, signedOn: string | null): 'required' | 'future' | 'beforeSigning' | undefined {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!DATE_TEXT.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'required';
  if (value > today) return 'future';
  if (signedOn !== null && value < signedOn) return 'beforeSigning';
  return undefined;
}
