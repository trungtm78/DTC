/** The permissions of the signature screen (x-permission in openapi.json). */
export const VERIFY_SIGNATURES_PERMISSION = 'doc.signature.verify';
export const READ_SIGNATURES_PERMISSION = 'doc.signature.read';

export const OVERALL_STATUSES = ['VALID', 'INVALID', 'INDETERMINATE'] as const;
export type Overall = (typeof OVERALL_STATUSES)[number];
export const ROLES = ['LEADER', 'ORGANIZATION', 'EXTERNAL', 'DOCUMENT_TIMESTAMP'] as const;
export type Role = (typeof ROLES)[number];
export const CHAIN_STATUSES = ['TRUSTED', 'UNTRUSTED', 'INCOMPLETE', 'NOT_CHECKED'] as const;
export type ChainStatus = (typeof CHAIN_STATUSES)[number];
export const REVOCATION_STATUSES = ['GOOD', 'REVOKED', 'UNKNOWN', 'NOT_CHECKED'] as const;
export type RevocationStatus = (typeof REVOCATION_STATUSES)[number];
export const PROFILES = ['PADES_B_B', 'PADES_B_T', 'PADES_B_LT', 'PADES_B_LTA'] as const;
export type Profile = (typeof PROFILES)[number];
export const REGIMES = ['PUBLIC_CA', 'GOV_SPECIALIZED'] as const;
export type Regime = (typeof REGIMES)[number];
export const POLICIES = ['STRICT', 'LENIENT_TIME'] as const;
export type Policy = (typeof POLICIES)[number];

/** One signature of the latest verification, as `getDocumentSignatureReport` returns it. */
export interface SignatureRow {
  index: number;
  role: Role;
  verificationNo: number;
  subjectDn: string | null;
  issuerDn: string | null;
  serial: string | null;
  trustRegime: Regime | null;
  profile: Profile | null;
  docmdpLevel: number | null;
  signedAt: string | null;
  timestampAt: string | null;
  status: Overall;
  chainStatus: ChainStatus;
  revocationStatus: RevocationStatus;
  incrementalChangesAllowed: boolean | null;
  findings: string[];
  verifiedAt: string | null;
  registeredCertificateId: string | null;
}

export interface Report {
  versionId: string;
  overall: Overall;
  signatures: SignatureRow[];
}

/** The facts of the version that the screen shows next to the report (`get_resources_document_version_id`). */
export interface VersionFacts {
  id: string;
  documentId: string;
  version: number;
  stage: string;
  mime: string;
  pageCount: number;
  checksum: string;
  scanStatus: string;
  createdAt: string;
}

export interface VersionPage {
  items: VersionFacts[];
  nextCursor: string | null;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableText = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.find((candidate) => candidate === value) ?? fallback;
const nullableOneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => allowed.find((candidate) => candidate === value) ?? null;

export function toSignature(raw: unknown): SignatureRow {
  const row: Raw = isRecord(raw) ? raw : {};
  return {
    index: count(row.index),
    role: oneOf(row.role, ROLES, 'EXTERNAL'),
    verificationNo: count(row.verification_no),
    subjectDn: nullableText(row.subject_dn),
    issuerDn: nullableText(row.issuer_dn),
    serial: nullableText(row.serial),
    trustRegime: nullableOneOf(row.trust_regime, REGIMES),
    profile: nullableOneOf(row.profile, PROFILES),
    docmdpLevel: typeof row.docmdp_level === 'number' ? row.docmdp_level : null,
    signedAt: nullableText(row.signed_at),
    timestampAt: nullableText(row.timestamp_at),
    status: oneOf(row.status, OVERALL_STATUSES, 'INDETERMINATE'),
    chainStatus: oneOf(row.chain_status, CHAIN_STATUSES, 'NOT_CHECKED'),
    revocationStatus: oneOf(row.revocation_status, REVOCATION_STATUSES, 'NOT_CHECKED'),
    incrementalChangesAllowed: typeof row.incremental_changes_allowed === 'boolean' ? row.incremental_changes_allowed : null,
    findings: Array.isArray(row.findings) ? row.findings.filter((item): item is string => typeof item === 'string') : [],
    verifiedAt: nullableText(row.verified_at),
    registeredCertificateId: nullableText(row.registered_certificate_id),
  };
}

export function toReport(raw: unknown): Report {
  const body: Raw = isRecord(raw) ? raw : {};
  return {
    versionId: text(body.version_id),
    overall: oneOf(body.overall, OVERALL_STATUSES, 'INDETERMINATE'),
    signatures: Array.isArray(body.signatures) ? body.signatures.map(toSignature) : [],
  };
}

export function toVersion(raw: unknown): VersionFacts {
  const row: Raw = isRecord(raw) ? raw : {};
  return {
    id: text(row.id),
    documentId: text(row.document_id),
    version: count(row.version),
    stage: text(row.stage),
    mime: text(row.mime),
    pageCount: count(row.page_count),
    checksum: text(row.checksum),
    scanStatus: text(row.scan_status),
    createdAt: text(row.created_at),
  };
}

export function toVersionPage(raw: unknown): VersionPage {
  const body: Raw = isRecord(raw) ? raw : {};
  return {
    items: Array.isArray(body.items) ? body.items.map(toVersion) : [],
    nextCursor: nullableText(body.next_cursor),
  };
}
