/** The permissions of the signing and numbering screens (x-permission in openapi.json). */
export const READ_OUTGOING_PERMISSION = 'doc.outgoing.read';
export const SIGN_OUTGOING_PERMISSION = 'doc.outgoing.sign';
export const NUMBER_OUTGOING_PERMISSION = 'doc.outgoing.number';
export const SEAL_OUTGOING_PERMISSION = 'doc.outgoing.seal';

export const DOCUMENT_STATUSES = ['DRAFT', 'IN_REVIEW', 'SUBMITTED', 'SIGNED', 'NUMBERED', 'SEALED', 'ISSUED', 'OTHER'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const SESSION_ROLES = ['LEADER', 'ORGANIZATION'] as const;
export type SessionRole = (typeof SESSION_ROLES)[number];
export const SESSION_STATUSES = ['CREATED', 'HASH_READY', 'AWAITING_SIGNER', 'SIGNED', 'EMBEDDED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const ADAPTER_CODES = ['REMOTE_CA', 'LOCAL_AGENT', 'MOCK'] as const;
export type AdapterCode = (typeof ADAPTER_CODES)[number];
export const ADAPTER_STATUSES = ['VERIFIED', 'PROPOSED', 'MOCK', 'MISSING'] as const;
export type AdapterStatus = (typeof ADAPTER_STATUSES)[number];
export const SIGNATURE_STATUSES = ['VALID', 'INVALID', 'INDETERMINATE'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

/** One outgoing document as `listOutgoingDocuments` and `getOutgoingDocument` carry it. */
export interface OutgoingRow {
  id: string;
  documentId: string;
  title: string;
  docTypeCode: string;
  status: DocumentStatus;
  draftingUnitId: string;
  drafterUserId: string;
  signerUserId: string | null;
  signerTitle: string | null;
  registerId: string | null;
  documentNumber: number | null;
  symbol: string | null;
  issuedOn: string | null;
  currentVersionId: string | null;
  leaderSignedAt: string | null;
  numberedAt: string | null;
  sealedAt: string | null;
  createdAt: string;
  version: number;
}

export interface SessionRow {
  id: string;
  role: SessionRole;
  status: SessionStatus;
  signerUserId: string | null;
  signingCertificateId: string | null;
  adapterCode: AdapterCode;
  adapterStatus: AdapterStatus;
  resultVersionId: string | null;
  digestHex: string | null;
  expiresAt: string;
  attempts: number;
  errorCode: string | null;
  createdAt: string;
  version: number;
}

export interface VersionRow {
  id: string;
  version: number;
  stage: string;
  checksum: string;
  pageCount: number;
  scanStatus: string;
  byteLength: number | null;
  prefixSha256: string | null;
  createdAt: string;
}

export interface CertificateOption {
  id: string;
  kind: 'PERSONAL' | 'ORGANIZATION';
  subjectDn: string;
  issuerDn: string;
  validUntil: string;
  status: string;
}

export interface SignatureBrief {
  role: string;
  status: SignatureStatus;
  subjectDn: string | null;
  signedAt: string | null;
  findings: string[];
}

export interface OutgoingDetail extends OutgoingRow {
  sessions: SessionRow[];
  versions: VersionRow[];
  certificates: CertificateOption[];
  signatures: SignatureBrief[];
}

export interface OutgoingPage {
  items: OutgoingRow[];
  nextCursor: string | undefined;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullableText = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const nullableCount = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.find((candidate) => candidate === value) ?? fallback;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function toOutgoing(raw: unknown): OutgoingRow {
  const row: Raw = isRecord(raw) ? raw : {};
  return {
    id: text(row.id),
    documentId: text(row.document_id),
    title: text(row.title),
    docTypeCode: text(row.doc_type_code),
    status: oneOf(row.status, DOCUMENT_STATUSES, 'OTHER'),
    draftingUnitId: text(row.drafting_unit_id),
    drafterUserId: text(row.drafter_user_id),
    signerUserId: nullableText(row.signer_user_id),
    signerTitle: nullableText(row.signer_title),
    registerId: nullableText(row.register_id),
    documentNumber: nullableCount(row.document_number),
    symbol: nullableText(row.symbol),
    issuedOn: nullableText(row.issued_on),
    currentVersionId: nullableText(row.current_version_id),
    leaderSignedAt: nullableText(row.leader_signed_at),
    numberedAt: nullableText(row.numbered_at),
    sealedAt: nullableText(row.sealed_at),
    createdAt: text(row.created_at),
    version: count(row.version),
  };
}

export function toSession(raw: unknown): SessionRow {
  const row: Raw = isRecord(raw) ? raw : {};
  return {
    id: text(row.id),
    role: oneOf(row.role, SESSION_ROLES, 'LEADER'),
    status: oneOf(row.status, SESSION_STATUSES, 'CREATED'),
    signerUserId: nullableText(row.signer_user_id),
    signingCertificateId: nullableText(row.signing_certificate_id),
    adapterCode: oneOf(row.adapter_code, ADAPTER_CODES, 'MOCK'),
    adapterStatus: oneOf(row.adapter_status, ADAPTER_STATUSES, 'MISSING'),
    resultVersionId: nullableText(row.result_version_id),
    digestHex: nullableText(row.digest_hex),
    expiresAt: text(row.expires_at),
    attempts: count(row.attempts),
    errorCode: nullableText(row.error_code),
    createdAt: text(row.created_at),
    version: count(row.version),
  };
}

export function toVersion(raw: unknown): VersionRow {
  const row: Raw = isRecord(raw) ? raw : {};
  return {
    id: text(row.id),
    version: count(row.version),
    stage: text(row.stage),
    checksum: text(row.checksum),
    pageCount: count(row.page_count),
    scanStatus: text(row.scan_status),
    byteLength: nullableCount(row.byte_length),
    prefixSha256: nullableText(row.prefix_sha256),
    createdAt: text(row.created_at),
  };
}

export function toCertificate(raw: unknown): CertificateOption {
  const row: Raw = isRecord(raw) ? raw : {};
  return {
    id: text(row.id),
    kind: row.kind === 'ORGANIZATION' ? 'ORGANIZATION' : 'PERSONAL',
    subjectDn: text(row.subject_dn),
    issuerDn: text(row.issuer_dn),
    validUntil: text(row.valid_until),
    status: text(row.status),
  };
}

export function toSignature(raw: unknown): SignatureBrief {
  const row: Raw = isRecord(raw) ? raw : {};
  return {
    role: text(row.role),
    status: oneOf(row.status, SIGNATURE_STATUSES, 'INDETERMINATE'),
    subjectDn: nullableText(row.subject_dn),
    signedAt: nullableText(row.signed_at),
    findings: list(row.findings).filter((item): item is string => typeof item === 'string'),
  };
}

export function toDetail(raw: unknown): OutgoingDetail {
  const body: Raw = isRecord(raw) ? raw : {};
  return {
    ...toOutgoing(body),
    sessions: list(body.sessions).map(toSession),
    versions: list(body.versions).map(toVersion),
    certificates: list(body.certificates).map(toCertificate),
    signatures: list(body.signatures).map(toSignature),
  };
}

export function toPage(raw: unknown): OutgoingPage {
  const body: Raw = isRecord(raw) ? raw : {};
  return { items: list(body.items).map(toOutgoing), nextCursor: typeof body.next_cursor === 'string' ? body.next_cursor : undefined };
}
