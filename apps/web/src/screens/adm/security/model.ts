import { ApiError } from '@machvon/api-client';

/** Permissions of the commands (x-permission in openapi.json) and of the reads added by CR-ADM-06. */
export const MANAGE_CERTIFICATES_PERMISSION = 'adm.signature.manage';
export const DRAFT_POLICY_PERMISSION = 'adm.security.manage';
export const APPROVE_POLICY_PERMISSION = 'adm.security.approve';

/** A certificate that ends within this many days is warned about (ADM-08). */
export const EXPIRY_WARNING_DAYS = 30;
const DAY_MS = 86_400_000;

export const CERTIFICATE_KINDS = ['PERSONAL', 'ORGANIZATION'] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];
export type CertificateStatus = 'Active' | 'Expired' | 'Revoked' | 'Suspended';
export type PolicyStatus = 'Draft' | 'Published' | 'Superseded';

/** One signing certificate as `get_resources_signing_certificate` returns it: public facts only. */
export interface CertificateView {
  id: string;
  kind: CertificateKind;
  holderMembershipId: string | null;
  organizationUnitId: string | null;
  serial: string;
  issuerDn: string;
  subjectDn: string;
  providerCode: string;
  validFrom: string;
  validUntil: string;
  fingerprint: string;
  status: CertificateStatus;
  statusReason: string | null;
  version: number;
}

/** One security policy version as `get_resources_security_policy_version` returns it. */
export interface PolicyView {
  id: string;
  revision: number;
  status: PolicyStatus;
  mfaRequiredRoles: string[];
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  ipAllowlist: string[];
  downloadTtlMinutes: number | null;
  exportWatermark: boolean;
  createdBy: string;
  approvedBy: string | null;
  publishedAt: string | null;
  version: number;
}

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
const CERTIFICATE_STATUSES: readonly string[] = ['Active', 'Expired', 'Revoked', 'Suspended'];
const POLICY_STATUSES: readonly string[] = ['Draft', 'Published', 'Superseded'];

export function toCertificate(raw: unknown): CertificateView | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string') return undefined;
  return {
    id: raw.id,
    kind: raw.kind === 'ORGANIZATION' ? 'ORGANIZATION' : 'PERSONAL',
    holderMembershipId: textOrNull(raw.holder_membership_id),
    organizationUnitId: textOrNull(raw.organization_unit_id),
    serial: text(raw.certificate_serial),
    issuerDn: text(raw.issuer_dn),
    subjectDn: text(raw.subject_dn),
    providerCode: text(raw.provider_code),
    validFrom: text(raw.valid_from),
    validUntil: text(raw.valid_until),
    fingerprint: text(raw.fingerprint_sha256),
    status: CERTIFICATE_STATUSES.includes(text(raw.status)) ? (raw.status as CertificateStatus) : 'Active',
    statusReason: textOrNull(raw.status_reason),
    version: count(raw.version),
  };
}

export function toPolicy(raw: unknown): PolicyView | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string') return undefined;
  return {
    id: raw.id,
    revision: count(raw.revision),
    status: POLICY_STATUSES.includes(text(raw.status)) ? (raw.status as PolicyStatus) : 'Draft',
    mfaRequiredRoles: strings(raw.mfa_required_roles),
    sessionIdleMinutes: count(raw.session_idle_minutes),
    sessionMaxHours: count(raw.session_max_hours),
    ipAllowlist: strings(raw.ip_allowlist),
    downloadTtlMinutes: typeof raw.download_ttl_minutes === 'number' ? raw.download_ttl_minutes : null,
    exportWatermark: raw.export_watermark === true,
    createdBy: text(raw.created_by),
    approvedBy: textOrNull(raw.approved_by),
    publishedAt: textOrNull(raw.published_at),
    version: count(raw.version),
  };
}

export type ExpiryState = 'ok' | 'expiring' | 'expired' | 'revoked';

/** Whole days from `now` to the end of the validity (negative once it ended). */
export function daysUntil(validUntil: string, now: Date): number {
  return Math.floor((new Date(validUntil).getTime() - now.getTime()) / DAY_MS);
}

/** What the register shows for a certificate: a revoked one is final, an ended one is expired, one ending within 30 days is warned about. */
export function expiryState(certificate: Pick<CertificateView, 'status' | 'validUntil'>, now: Date): ExpiryState {
  if (certificate.status === 'Revoked') return 'revoked';
  if (certificate.status === 'Expired' || new Date(certificate.validUntil).getTime() <= now.getTime()) return 'expired';
  return daysUntil(certificate.validUntil, now) < EXPIRY_WARNING_DAYS ? 'expiring' : 'ok';
}

export type ProblemReason =
  | 'certificateInvalid'
  | 'certificateExpired'
  | 'certificateDuplicate'
  | 'policyInvalid'
  | 'selfApproval'
  | 'conflict'
  | 'stage'
  | 'invalid'
  | 'notFound'
  | 'denied'
  | 'session'
  | 'general';

export interface ProblemView {
  reason: ProblemReason;
  /** The server's name of the field the problem is about (`detail`), when it gave one. */
  field: string | undefined;
}

const REASON_BY_CODE: Readonly<Record<string, ProblemReason>> = {
  CERTIFICATE_INVALID: 'certificateInvalid',
  CERTIFICATE_EXPIRED: 'certificateExpired',
  CERTIFICATE_DUPLICATE: 'certificateDuplicate',
  POLICY_INVALID: 'policyInvalid',
  SELF_APPROVAL_DENIED: 'selfApproval',
  VERSION_CONFLICT: 'conflict',
  STAGE_TRANSITION_DENIED: 'stage',
  VALIDATION_FAILED: 'invalid',
  INVALID_REQUEST: 'invalid',
  RESOURCE_NOT_FOUND: 'notFound',
  SCOPE_DENIED: 'denied',
  ENTITLEMENT_DENIED: 'denied',
  SESSION_EXPIRED: 'session',
};

/** Maps an error of a command of these screens to what they show; an unknown failure is the general message. */
export function describeProblem(error: unknown): ProblemView {
  if (!(error instanceof ApiError)) return { reason: 'general', field: undefined };
  return { reason: REASON_BY_CODE[error.code] ?? 'general', field: error.detail };
}

export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 2000;
export const PEM_MAX_LENGTH = 20_000;

export interface CertificateValues {
  kind: CertificateKind;
  holderMembershipId: string;
  organizationUnitId: string;
  providerCode: string;
  certificatePem: string;
}

export const EMPTY_CERTIFICATE_VALUES: CertificateValues = { kind: 'PERSONAL', holderMembershipId: '', organizationUnitId: '', providerCode: '', certificatePem: '' };
export type CertificateField = keyof CertificateValues;
export type FieldProblem = 'required' | 'tooLong' | 'range' | 'order' | 'tooShort';
export type CertificateErrors = Partial<Record<CertificateField, FieldProblem>>;

export function validateCertificate(values: CertificateValues): CertificateErrors {
  const errors: CertificateErrors = {};
  if (values.kind === 'PERSONAL' && values.holderMembershipId === '') errors.holderMembershipId = 'required';
  if (values.kind === 'ORGANIZATION' && values.organizationUnitId === '') errors.organizationUnitId = 'required';
  if (values.providerCode.trim() === '') errors.providerCode = 'required';
  else if (values.providerCode.trim().length > 40) errors.providerCode = 'tooLong';
  if (values.certificatePem.trim() === '') errors.certificatePem = 'required';
  else if (values.certificatePem.length > PEM_MAX_LENGTH) errors.certificatePem = 'tooLong';
  return errors;
}

export function certificateBody(values: CertificateValues) {
  return {
    kind: values.kind,
    ...(values.kind === 'PERSONAL' ? { holder_membership_id: values.holderMembershipId } : { organization_unit_id: values.organizationUnitId }),
    certificate_pem: values.certificatePem.trim(),
    provider_code: values.providerCode.trim(),
  };
}

export interface PolicyValues {
  mfaRequiredRoles: string[];
  sessionIdleMinutes: string;
  sessionMaxHours: string;
  ipAllowlist: string;
  downloadTtlMinutes: string;
  exportWatermark: boolean;
}

export const EMPTY_POLICY_VALUES: PolicyValues = { mfaRequiredRoles: [], sessionIdleMinutes: '30', sessionMaxHours: '8', ipAllowlist: '', downloadTtlMinutes: '', exportWatermark: false };
export type PolicyField = 'sessionIdleMinutes' | 'sessionMaxHours' | 'downloadTtlMinutes' | 'ipAllowlist';
export type PolicyErrors = Partial<Record<PolicyField, FieldProblem>>;

const IDLE_RANGE = { min: 5, max: 240 } as const;
const HOURS_RANGE = { min: 1, max: 24 } as const;
const TTL_RANGE = { min: 1, max: 1440 } as const;
const MAX_ALLOWLIST_ENTRIES = 200;
const WHOLE_NUMBER = /^[0-9]{1,5}$/;
const MINUTES_PER_HOUR = 60;

const wholeNumber = (value: string): number | undefined => (WHOLE_NUMBER.test(value.trim()) ? Number(value.trim()) : undefined);
export const allowlistOf = (value: string): string[] => value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');

/** The limits of the request schema and the rule the server states again (an idle limit is never longer than the session). */
export function validatePolicy(values: PolicyValues): PolicyErrors {
  const errors: PolicyErrors = {};
  const idle = wholeNumber(values.sessionIdleMinutes);
  const hours = wholeNumber(values.sessionMaxHours);
  if (idle === undefined) errors.sessionIdleMinutes = 'required';
  else if (idle < IDLE_RANGE.min || idle > IDLE_RANGE.max) errors.sessionIdleMinutes = 'range';
  if (hours === undefined) errors.sessionMaxHours = 'required';
  else if (hours < HOURS_RANGE.min || hours > HOURS_RANGE.max) errors.sessionMaxHours = 'range';
  if (errors.sessionIdleMinutes === undefined && errors.sessionMaxHours === undefined && (idle as number) > (hours as number) * MINUTES_PER_HOUR) errors.sessionIdleMinutes = 'order';
  if (values.downloadTtlMinutes.trim() !== '') {
    const ttl = wholeNumber(values.downloadTtlMinutes);
    if (ttl === undefined || ttl < TTL_RANGE.min || ttl > TTL_RANGE.max) errors.downloadTtlMinutes = 'range';
  }
  const allowlist = allowlistOf(values.ipAllowlist);
  if (allowlist.length > MAX_ALLOWLIST_ENTRIES) errors.ipAllowlist = 'tooLong';
  return errors;
}

export function policyBody(values: PolicyValues) {
  const allowlist = allowlistOf(values.ipAllowlist);
  return {
    mfa_required_roles: values.mfaRequiredRoles,
    session_idle_minutes: Number(values.sessionIdleMinutes),
    session_max_hours: Number(values.sessionMaxHours),
    ...(allowlist.length > 0 ? { ip_allowlist: allowlist } : {}),
    ...(values.downloadTtlMinutes.trim() !== '' ? { download_ttl_minutes: Number(values.downloadTtlMinutes) } : {}),
    export_watermark: values.exportWatermark,
  };
}

/** The revision a draft is started from: the form of the version in force, so a change is one edit away. */
export function valuesOfPolicy(policy: PolicyView): PolicyValues {
  return {
    mfaRequiredRoles: [...policy.mfaRequiredRoles],
    sessionIdleMinutes: String(policy.sessionIdleMinutes),
    sessionMaxHours: String(policy.sessionMaxHours),
    ipAllowlist: policy.ipAllowlist.join('\n'),
    downloadTtlMinutes: policy.downloadTtlMinutes === null ? '' : String(policy.downloadTtlMinutes),
    exportWatermark: policy.exportWatermark,
  };
}
