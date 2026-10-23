import type { ByteRange, ChainStatus, PadesProfile, RevocationStatus, SignatureResult, SignatureRole, SignatureStatus, TrustRegime } from '@machvon/kernel';
import type { TenantTx } from './tenant-database.ts';

/** One stored signature of a verification (`document_signature`): the public facts and the verdicts, nothing secret. */
export interface StoredSignature {
  id: string;
  versionId: string;
  verificationNo: number;
  index: number;
  role: SignatureRole;
  /** The registered signing certificate (ADM-08) the signer certificate matches by fingerprint, when there is one. */
  signingCertificateId: string | null;
  subjectDn: string | null;
  issuerDn: string | null;
  serial: string | null;
  fingerprintSha256: string | null;
  trustRegime: TrustRegime | null;
  profile: PadesProfile | null;
  docmdpLevel: number | null;
  byteRange: ByteRange | null;
  coversEndOffset: number | null;
  signedAt: Date | null;
  timestampAt: Date | null;
  status: SignatureStatus;
  chainStatus: ChainStatus;
  revocationStatus: RevocationStatus;
  incrementalChangesAllowed: boolean | null;
  findings: string[];
  verifiedAt: Date;
  verifierVersion: string;
  reportObjectKey: string | null;
}

export interface NewVerification {
  versionId: string;
  signatures: readonly SignatureResult[];
  verifiedAt: Date;
  verifierVersion: string;
  reportObjectKey: string | null;
}

interface Row {
  id: string;
  document_version_id: string;
  verification_no: number;
  signature_index: number;
  role: SignatureRole;
  signing_certificate_id: string | null;
  cert_subject_dn: string | null;
  cert_issuer_dn: string | null;
  cert_serial: string | null;
  cert_fingerprint_sha256: string | null;
  trust_regime: TrustRegime | null;
  profile: PadesProfile | null;
  docmdp_level: number | null;
  byte_range: ByteRange | null;
  covers_end_offset: string | null;
  signed_at: Date | null;
  timestamp_at: Date | null;
  verification_status: SignatureStatus | 'NOT_VERIFIED';
  chain_status: ChainStatus;
  revocation_status: RevocationStatus;
  incremental_changes_allowed: boolean | null;
  failure_codes: string[];
  verified_at: Date;
  verifier_version: string;
  report_object_key: string | null;
}

const COLUMNS = `id, document_version_id, verification_no, signature_index, role, signing_certificate_id, cert_subject_dn,
  cert_issuer_dn, cert_serial, cert_fingerprint_sha256, trust_regime, profile, docmdp_level, byte_range,
  covers_end_offset::text as covers_end_offset, signed_at, timestamp_at, verification_status, chain_status,
  revocation_status, incremental_changes_allowed, failure_codes, verified_at, verifier_version, report_object_key`;

function toStored(row: Row): StoredSignature {
  return {
    id: row.id,
    versionId: row.document_version_id,
    verificationNo: row.verification_no,
    index: row.signature_index,
    role: row.role,
    signingCertificateId: row.signing_certificate_id,
    subjectDn: row.cert_subject_dn,
    issuerDn: row.cert_issuer_dn,
    serial: row.cert_serial,
    fingerprintSha256: row.cert_fingerprint_sha256,
    trustRegime: row.trust_regime,
    profile: row.profile,
    docmdpLevel: row.docmdp_level,
    byteRange: row.byte_range,
    coversEndOffset: row.covers_end_offset === null ? null : Number(row.covers_end_offset),
    signedAt: row.signed_at,
    timestampAt: row.timestamp_at,
    // NOT_VERIFIED is a stored value for rows that were never evaluated; the report treats them as undecided.
    status: row.verification_status === 'NOT_VERIFIED' ? 'INDETERMINATE' : row.verification_status,
    chainStatus: row.chain_status,
    revocationStatus: row.revocation_status,
    incrementalChangesAllowed: row.incremental_changes_allowed,
    findings: row.failure_codes,
    verifiedAt: row.verified_at,
    verifierVersion: row.verifier_version,
    reportObjectKey: row.report_object_key,
  };
}

/**
 * The results of verifying the signatures of a document version (ST-DOC-003). Every verification adds new rows with the
 * next verification number; no row is ever updated or deleted by this store, so earlier results stay as evidence.
 * Every query runs inside the caller's tenant transaction.
 */
export class SignatureStore {
  /**
   * Stores a verification as the next number for the version and returns its rows. A verification that found no
   * signature stores nothing, and the number is not consumed.
   */
  async record(tx: TenantTx, input: NewVerification): Promise<StoredSignature[]> {
    if (input.signatures.length === 0) return [];
    // Two verifications of one version at the same time must not take the same number.
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`document_signature:${input.versionId}`]);
    const [next] = await tx.query<{ next: number }>(
      'select coalesce(max(verification_no), 0) + 1 as next from machvon.document_signature where document_version_id = $1::uuid',
      [input.versionId],
    );
    const verificationNo = Number(next?.next ?? 1);
    const fingerprints = input.signatures.flatMap((signature) => (signature.fingerprintSha256 === null ? [] : [signature.fingerprintSha256]));
    const registered = await this.registeredCertificates(tx, fingerprints);
    const stored: StoredSignature[] = [];
    for (const signature of input.signatures) {
      const [row] = await tx.query<Row>(
        `insert into machvon.document_signature
           (tenant_id, id, document_version_id, verification_no, signature_index, role, signing_certificate_id, cert_subject_dn, cert_issuer_dn,
            cert_serial, cert_fingerprint_sha256, trust_regime, profile, docmdp_level, byte_range, covers_end_offset, signed_at, timestamp_at,
            verification_status, chain_status, revocation_status, incremental_changes_allowed, failure_codes, verified_at, verifier_version,
            report_object_key)
         values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11,
            $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23, $24)
         returning ${COLUMNS}`,
        [
          input.versionId,
          verificationNo,
          signature.index,
          signature.role,
          signature.fingerprintSha256 === null ? null : (registered.get(signature.fingerprintSha256) ?? null),
          signature.subjectDn,
          signature.issuerDn,
          signature.serial,
          signature.fingerprintSha256,
          signature.trustRegime,
          signature.profile,
          signature.docmdpLevel,
          signature.byteRange === null ? null : JSON.stringify(signature.byteRange),
          signature.coversEndOffset,
          signature.signedAt,
          signature.timestampAt,
          signature.status,
          signature.chainStatus,
          signature.revocationStatus,
          signature.incrementalChangesAllowed,
          JSON.stringify(signature.findings),
          input.verifiedAt,
          input.verifierVersion,
          input.reportObjectKey,
        ],
      );
      if (row === undefined) throw new Error('signature insert returned no row');
      stored.push(toStored(row));
    }
    return stored;
  }

  /** The rows of the latest verification of a version, in signature order; empty when it was never verified. */
  async latest(tx: TenantTx, versionId: string): Promise<StoredSignature[]> {
    const rows = await tx.query<Row>(
      `select ${COLUMNS} from machvon.document_signature
        where document_version_id = $1::uuid
          and verification_no = (select max(verification_no) from machvon.document_signature where document_version_id = $1::uuid)
        order by signature_index`,
      [versionId],
    );
    return rows.map(toStored);
  }

  /** Every stored verification of a version, oldest first. */
  async history(tx: TenantTx, versionId: string): Promise<StoredSignature[]> {
    const rows = await tx.query<Row>(
      `select ${COLUMNS} from machvon.document_signature where document_version_id = $1::uuid order by verification_no, signature_index`,
      [versionId],
    );
    return rows.map(toStored);
  }

  private async registeredCertificates(tx: TenantTx, fingerprints: readonly string[]): Promise<Map<string, string>> {
    if (fingerprints.length === 0) return new Map();
    const rows = await tx.query<{ id: string; fingerprint_sha256: string }>(
      'select id, fingerprint_sha256 from machvon.signing_certificate where fingerprint_sha256 = any($1::text[])',
      [fingerprints],
    );
    return new Map(rows.map((row) => [row.fingerprint_sha256, row.id]));
  }
}
