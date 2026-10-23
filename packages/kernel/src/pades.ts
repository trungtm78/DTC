/** Which part of the document a signature stands for (`document_signature.role`). */
export type SignatureRole = 'LEADER' | 'ORGANIZATION' | 'EXTERNAL' | 'DOCUMENT_TIMESTAMP';

/** The trust list a signature is checked against (BR-DOC-15): the two lists are never mixed in one signature. */
export type TrustRegime = 'PUBLIC_CA' | 'GOV_SPECIALIZED';

export const TRUST_REGIMES: readonly TrustRegime[] = ['PUBLIC_CA', 'GOV_SPECIALIZED'];

export type PadesProfile = 'PADES_B_B' | 'PADES_B_T' | 'PADES_B_LT' | 'PADES_B_LTA';

export type SignatureStatus = 'VALID' | 'INVALID' | 'INDETERMINATE';
export type ChainStatus = 'TRUSTED' | 'UNTRUSTED' | 'INCOMPLETE' | 'NOT_CHECKED';
export type RevocationStatus = 'GOOD' | 'REVOKED' | 'UNKNOWN' | 'NOT_CHECKED';

/** `STRICT` accepts only fully valid signatures; `LENIENT_TIME` also accepts a signing time nobody proved (BR-DOC-14 f5). */
export type VerificationPolicy = 'STRICT' | 'LENIENT_TIME';

/** Findings that make a signature INVALID: the document cannot be relied on whatever else is learned. */
export const INVALID_FINDINGS = [
  'BYTE_RANGE_INVALID',
  'SIGNATURE_MALFORMED',
  'DIGEST_MISMATCH',
  'SIGNATURE_INVALID',
  'ALGORITHM_NOT_ALLOWED',
  'SIGNER_CERTIFICATE_MISMATCH',
  'CHAIN_UNTRUSTED',
  'CERTIFICATE_EXPIRED_AT_SIGNING',
  'CERTIFICATE_REVOKED',
  'INCREMENTAL_CHANGES_NOT_ALLOWED',
  'TIMESTAMP_INVALID',
  'SIGNING_ORDER_INVALID',
] as const;

/** Findings that leave the outcome open: something could not be established, nothing was found wrong. */
export const INDETERMINATE_FINDINGS = ['CHAIN_INCOMPLETE', 'SIGNING_TIME_UNPROVEN', 'REVOCATION_UNKNOWN'] as const;

export type InvalidFinding = (typeof INVALID_FINDINGS)[number];
export type IndeterminateFinding = (typeof INDETERMINATE_FINDINGS)[number];
export type SignatureFinding = InvalidFinding | IndeterminateFinding;

export type ByteRange = readonly [number, number, number, number];

/** What the report keeps of one signature: public certificate data and the verdicts, never key material. */
export interface SignatureResult {
  /** Position of the signature in the file, from 0. */
  index: number;
  role: SignatureRole;
  subjectDn: string | null;
  issuerDn: string | null;
  serial: string | null;
  /** SHA-256 of the DER signer certificate, lower-case hexadecimal. */
  fingerprintSha256: string | null;
  trustRegime: TrustRegime | null;
  profile: PadesProfile;
  /** DocMDP permission level (1 to 3) when the signature certifies the document. */
  docmdpLevel: number | null;
  byteRange: ByteRange | null;
  /** First byte after the last byte the signature covers. */
  coversEndOffset: number | null;
  /** The proven signing time when a timestamp proves it, otherwise the time the signer declared. */
  signedAt: Date | null;
  timestampAt: Date | null;
  status: SignatureStatus;
  chainStatus: ChainStatus;
  revocationStatus: RevocationStatus;
  /** Whether every later revision stays inside the allowed set; null when the signature could not be located. */
  incrementalChangesAllowed: boolean | null;
  findings: SignatureFinding[];
}

export interface SignatureReport {
  overall: SignatureStatus;
  verifiedAt: Date;
  verifierVersion: string;
  signatures: SignatureResult[];
}

const INVALID_SET: ReadonlySet<string> = new Set(INVALID_FINDINGS);
const INDETERMINATE_SET: ReadonlySet<string> = new Set(INDETERMINATE_FINDINGS);

/** The status the findings of one signature add up to: any hard finding wins over an open one. */
export function statusOfFindings(findings: readonly string[]): SignatureStatus {
  if (findings.some((finding) => INVALID_SET.has(finding))) return 'INVALID';
  if (findings.some((finding) => INDETERMINATE_SET.has(finding))) return 'INDETERMINATE';
  return 'VALID';
}

function acceptedUnder(policy: VerificationPolicy, signature: SignatureResult): boolean {
  if (signature.status === 'VALID') return true;
  return (
    policy === 'LENIENT_TIME' &&
    signature.status === 'INDETERMINATE' &&
    signature.findings.every((finding) => finding === 'SIGNING_TIME_UNPROVEN')
  );
}

/**
 * The overall outcome (BR-DOC-14 f): VALID only when every signature is VALID, or, under LENIENT_TIME, when the only
 * thing missing is a proven signing time. A file without any signature is INDETERMINATE: nothing vouches for it.
 */
export function overallOf(signatures: readonly SignatureResult[], policy: VerificationPolicy): SignatureStatus {
  if (signatures.length === 0) return 'INDETERMINATE';
  if (signatures.some((signature) => signature.status === 'INVALID')) return 'INVALID';
  return signatures.every((signature) => acceptedUnder(policy, signature)) ? 'VALID' : 'INDETERMINATE';
}

const MIN_RSA_BITS = 2048;
const RSA_SIGNATURE_OIDS: ReadonlySet<string> = new Set([
  '1.2.840.113549.1.1.1',
  '1.2.840.113549.1.1.11',
  '1.2.840.113549.1.1.12',
  '1.2.840.113549.1.1.13',
]);
const ECDSA_SIGNATURE_OIDS: ReadonlySet<string> = new Set([
  '1.2.840.10045.2.1',
  '1.2.840.10045.4.3.2',
  '1.2.840.10045.4.3.3',
  '1.2.840.10045.4.3.4',
]);
const DIGEST_NAMES: Readonly<Record<string, string>> = {
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};
const ALLOWED_CURVES: ReadonlySet<string> = new Set(['prime256v1', 'secp384r1', 'secp521r1']);

export interface AlgorithmChoice {
  oidSignature: string;
  oidDigest: string;
  keyType: string | undefined;
  rsaBits?: number;
  curve?: string;
}

/** The Node digest name for an allowed digest algorithm OID (SHA-256 or stronger), otherwise null. */
export function allowedDigestName(oid: string): string | null {
  return DIGEST_NAMES[oid] ?? null;
}

/**
 * The algorithm allow-list of BR-DOC-14: RSA keys of at least 2048 bits or ECDSA on P-256 and above, with SHA-256 or a
 * stronger digest. Anything else (SHA-1, short keys, unknown algorithms) is refused.
 */
export function isAllowedAlgorithm(choice: AlgorithmChoice): boolean {
  if (allowedDigestName(choice.oidDigest) === null) return false;
  if (choice.keyType === 'rsa') return RSA_SIGNATURE_OIDS.has(choice.oidSignature) && (choice.rsaBits ?? 0) >= MIN_RSA_BITS;
  if (choice.keyType === 'ec') {
    return ECDSA_SIGNATURE_OIDS.has(choice.oidSignature) && ALLOWED_CURVES.has(choice.curve ?? '');
  }
  return false;
}
