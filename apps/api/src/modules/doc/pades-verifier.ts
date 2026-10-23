import type { X509Certificate } from 'node:crypto';
import { overallOf, statusOfFindings } from '@machvon/kernel';
import type {
  PadesProfile,
  RevocationStatus,
  SignatureFinding,
  SignatureReport,
  SignatureResult,
  SignatureRole,
  VerificationPolicy,
} from '@machvon/kernel';
import { buildChain, checkCms, checkTimestampToken, derLength, fingerprintOf, validAt } from './cms-verification';
import type { ChainOutcome, TrustStore } from './cms-verification';
import { dictionaryOf, nameOf, readRevision, revisionBoundary, revisionEnds, textOf } from './pdf-objects';
import type { PdfValue } from './pdf-objects';
import { analyseLaterRevisions } from './pdf-revisions';

export const VERIFIER_VERSION = 'machvon-pades/1';

const FIELD_LEADER = 'sig_leader';
const FIELD_ORGANIZATION = 'sig_org';
const SUBFILTER_TIMESTAMP = 'ETSI.RFC3161';
const HEX_TEXT = /^(?:[0-9A-Fa-f]{2})*$/;

export interface RevocationQuery {
  certificate: Buffer;
  issuer: Buffer | null;
  /** The moment the status is wanted for: the proven signing time, otherwise now. */
  at: Date;
}

export interface RevocationAnswer {
  status: 'GOOD' | 'REVOKED' | 'UNKNOWN';
  revokedAt?: Date;
}

/** Revocation status through OCSP or CRL; the adapters live outside this module, tests use fakes. */
export interface RevocationPort {
  check(query: RevocationQuery): Promise<RevocationAnswer>;
}

export interface VerifyOptions {
  policy?: VerificationPolicy;
  /** When absent, revocation is not checked and the report says NOT_CHECKED. */
  revocation?: RevocationPort | undefined;
}

interface LocatedSignature {
  num: number;
  dictionary: Map<string, PdfValue>;
  fieldName: string | null;
  range: number[] | null;
}

function rangeOf(value: PdfValue | undefined): number[] | null {
  if (value?.t !== 'array' || value.v.length !== 4) return null;
  const numbers = value.v.map((item) => (item.t === 'num' && Number.isInteger(item.v) ? item.v : null));
  return numbers.every((item): item is number => item !== null) ? numbers : null;
}

function locate(text: string): { found: LocatedSignature[]; hasDss: boolean } {
  const objects = new Map<number, PdfValue>();
  let root: PdfValue | undefined;
  let start = 0;
  for (const end of revisionEnds(text)) {
    const content = readRevision(text, start, end);
    for (const object of content.objects) objects.set(object.num, object.value);
    root = content.trailer?.get('Root') ?? root;
    start = end;
  }
  const fieldNames = new Map<number, string>();
  for (const value of objects.values()) {
    const field = dictionaryOf(value);
    const reference = field?.get('V');
    const name = textOf(field?.get('T'));
    if (nameOf(field?.get('FT')) === 'Sig' && reference?.t === 'ref' && name !== null) fieldNames.set(reference.obj, name);
  }
  const found: LocatedSignature[] = [];
  for (const [num, value] of objects) {
    const dictionary = dictionaryOf(value);
    if (dictionary === null || !dictionary.has('ByteRange')) continue;
    found.push({ num, dictionary, fieldName: fieldNames.get(num) ?? null, range: rangeOf(dictionary.get('ByteRange')) });
  }
  const catalog = dictionaryOf(root?.t === 'ref' ? objects.get(root.obj) : undefined);
  return {
    found: found.sort((left, right) => coverageOf(left) - coverageOf(right) || left.num - right.num),
    hasDss: catalog?.has('DSS') === true,
  };
}

function coverageOf(located: LocatedSignature): number {
  return located.range === null ? Number.MAX_SAFE_INTEGER : (located.range[2] ?? 0) + (located.range[3] ?? 0);
}

function roleOf(located: LocatedSignature, timestamp: boolean): SignatureRole {
  if (timestamp) return 'DOCUMENT_TIMESTAMP';
  if (located.fieldName === FIELD_LEADER) return 'LEADER';
  if (located.fieldName === FIELD_ORGANIZATION) return 'ORGANIZATION';
  return 'EXTERNAL';
}

function docMdpLevelOf(dictionary: Map<string, PdfValue>): number | null {
  const references = dictionary.get('Reference');
  if (references?.t !== 'array') return null;
  for (const reference of references.v) {
    const entry = dictionaryOf(reference);
    if (nameOf(entry?.get('TransformMethod')) !== 'DocMDP') continue;
    const level = dictionaryOf(entry?.get('TransformParams'))?.get('P');
    if (level?.t === 'num' && [1, 2, 3].includes(level.v)) return level.v;
  }
  return null;
}

function blank(index: number, role: SignatureRole): SignatureResult {
  return {
    index,
    role,
    subjectDn: null,
    issuerDn: null,
    serial: null,
    fingerprintSha256: null,
    trustRegime: null,
    profile: 'PADES_B_B',
    docmdpLevel: null,
    byteRange: null,
    coversEndOffset: null,
    signedAt: null,
    timestampAt: null,
    status: 'INVALID',
    chainStatus: 'NOT_CHECKED',
    revocationStatus: 'NOT_CHECKED',
    incrementalChangesAllowed: null,
    findings: [],
  };
}

function describeCertificate(result: SignatureResult, certificate: X509Certificate): void {
  result.subjectDn = certificate.subject.replace(/\n/g, ', ');
  result.issuerDn = certificate.issuer.replace(/\n/g, ', ');
  result.serial = certificate.serialNumber;
  result.fingerprintSha256 = fingerprintOf(certificate);
}

interface Layout {
  text: string;
  bytes: Buffer;
  ends: number[];
  /** Whether the catalog, as the last revision leaves it, carries a DSS (validation data for long-term checks). */
  hasDss: boolean;
}

/** Checks `ByteRange` against the file (BR-DOC-14 f1) and returns the covered bytes and the CMS or token bytes. */
function readCoverage(layout: Layout, range: number[] | null): { covered: Buffer; contents: Buffer } | null {
  const [first, start, resume, rest] = range ?? [];
  if (first !== 0 || start === undefined || resume === undefined || rest === undefined) return null;
  if (start < 1 || start > resume || rest < 0 || resume + rest > layout.bytes.length) return null;
  if (revisionBoundary(layout.text, layout.ends, resume + rest) === undefined) return null;
  if (layout.text.charAt(start) !== '<' || layout.text.charAt(resume - 1) !== '>') return null;
  const hex = layout.text.slice(start + 1, resume - 1);
  if (!HEX_TEXT.test(hex)) return null;
  const padded = Buffer.from(hex, 'hex');
  const length = derLength(padded);
  if (length === null || length > padded.length) return null;
  return {
    covered: Buffer.concat([layout.bytes.subarray(0, start), layout.bytes.subarray(resume, resume + rest)]),
    contents: padded.subarray(0, length),
  };
}

interface Context {
  layout: Layout;
  trust: TrustStore;
  now: Date;
  options: VerifyOptions;
}

function profileOf(hasTimestamp: boolean, hasDss: boolean): PadesProfile {
  if (!hasTimestamp) return 'PADES_B_B';
  return hasDss ? 'PADES_B_LT' : 'PADES_B_T';
}

function chainFindings(chain: ChainOutcome): SignatureFinding[] {
  if (chain.status === 'UNTRUSTED') return ['CHAIN_UNTRUSTED'];
  return chain.status === 'INCOMPLETE' ? ['CHAIN_INCOMPLETE'] : [];
}

async function revocationOf(
  context: Context,
  chain: ChainOutcome,
  at: Date,
): Promise<{ status: RevocationStatus; findings: SignatureFinding[] }> {
  const signer = chain.path[0];
  const revocation = context.options.revocation;
  if (revocation === undefined || signer === undefined) return { status: 'NOT_CHECKED', findings: [] };
  const answer = await revocation.check({ certificate: signer.raw, issuer: chain.path[1]?.raw ?? null, at });
  if (answer.status === 'UNKNOWN') return { status: 'UNKNOWN', findings: ['REVOCATION_UNKNOWN'] };
  const revokedBeforeSigning = answer.status === 'REVOKED' && (answer.revokedAt === undefined || answer.revokedAt <= at);
  return revokedBeforeSigning ? { status: 'REVOKED', findings: ['CERTIFICATE_REVOKED'] } : { status: 'GOOD', findings: [] };
}

async function verifyOne(context: Context, located: LocatedSignature, index: number): Promise<SignatureResult> {
  const subFilter = nameOf(located.dictionary.get('SubFilter'));
  const isTimestamp = subFilter === SUBFILTER_TIMESTAMP;
  const result = blank(index, roleOf(located, isTimestamp));
  result.docmdpLevel = docMdpLevelOf(located.dictionary);
  const range = located.range;
  const coverage = readCoverage(context.layout, range);
  if (coverage === null || range === null) {
    result.findings.push('BYTE_RANGE_INVALID');
    result.status = statusOfFindings(result.findings);
    return result;
  }
  result.byteRange = [range[0] ?? 0, range[1] ?? 0, range[2] ?? 0, range[3] ?? 0];
  result.coversEndOffset = (range[2] ?? 0) + (range[3] ?? 0);
  const anchors = context.trust.anchors();
  const verdict = analyseLaterRevisions(context.layout.text, result.coversEndOffset);
  result.incrementalChangesAllowed = verdict.allowed;
  if (!verdict.allowed) result.findings.push('INCREMENTAL_CHANGES_NOT_ALLOWED');

  if (isTimestamp) {
    const token = checkTimestampToken(coverage.contents, coverage.covered, anchors);
    if (token === null) {
      result.findings.push('TIMESTAMP_INVALID');
    } else {
      describeCertificate(result, token.signer);
      result.signedAt = token.genTime;
      result.timestampAt = token.genTime;
      result.trustRegime = token.chain.regime;
      result.chainStatus = 'TRUSTED';
      result.profile = 'PADES_B_LTA';
    }
    result.status = statusOfFindings(result.findings);
    return result;
  }

  const facts = checkCms(coverage.contents, coverage.covered, 'DIGEST_MISMATCH');
  result.findings.push(...facts.findings);
  const signer = facts.signer;
  if (signer === null || facts.findings.includes('ALGORITHM_NOT_ALLOWED')) {
    result.status = statusOfFindings(result.findings);
    return result;
  }
  describeCertificate(result, signer);
  const timestamp = facts.timestampToken === null ? null : checkTimestampToken(facts.timestampToken, facts.signatureValue, anchors);
  if (facts.timestampToken !== null && timestamp === null) result.findings.push('TIMESTAMP_INVALID');
  result.timestampAt = timestamp?.genTime ?? null;
  result.signedAt = timestamp?.genTime ?? facts.declaredSigningTime;

  const chain = buildChain(signer, facts.pool, anchors);
  result.chainStatus = chain.status;
  result.trustRegime = chain.regime;
  result.findings.push(...chainFindings(chain));
  if (timestamp === null) {
    result.findings.push('SIGNING_TIME_UNPROVEN');
  } else if (!validAt(chain.path, timestamp.genTime)) {
    result.findings.push('CERTIFICATE_EXPIRED_AT_SIGNING');
  }
  if (statusOfFindings(result.findings) !== 'INVALID') {
    const revocation = await revocationOf(context, chain, timestamp?.genTime ?? context.now);
    result.revocationStatus = revocation.status;
    result.findings.push(...revocation.findings);
  }
  result.profile = profileOf(timestamp !== null, context.layout.hasDss);
  result.status = statusOfFindings(result.findings);
  return result;
}

/** BR-DOC-14 f8: the organisation seal comes after the leader's signature, in the file and in time. */
function checkOrder(signatures: SignatureResult[]): void {
  const leader = signatures.find((signature) => signature.role === 'LEADER');
  const organization = signatures.find((signature) => signature.role === 'ORGANIZATION');
  if (leader === undefined || organization === undefined) return;
  const inFile = (leader.coversEndOffset ?? 0) < (organization.coversEndOffset ?? 0);
  const inTime = leader.signedAt === null || organization.signedAt === null || leader.signedAt <= organization.signedAt;
  if (!inFile || !inTime) {
    organization.findings.push('SIGNING_ORDER_INVALID');
    organization.status = statusOfFindings(organization.findings);
  }
}

/** A later document timestamp turns a long-term profile into an archival one (B-LTA). */
function upgradeProfiles(signatures: SignatureResult[]): void {
  for (const signature of signatures) {
    const later = signatures.some(
      (other) => other.role === 'DOCUMENT_TIMESTAMP' && (other.coversEndOffset ?? 0) > (signature.coversEndOffset ?? 0),
    );
    if (later && signature.profile === 'PADES_B_LT') signature.profile = 'PADES_B_LTA';
  }
}

/**
 * Verifies every signature of a PDF (BR-DOC-14 f): coverage, digest, CMS signature, chain to the trust anchors,
 * signing time proven by an RFC 3161 timestamp, revocation, and the revisions appended after the signature. The report
 * keeps public certificate data only. `trust` supplies the anchors per regime; a revocation port is consulted when given.
 */
export async function verifyPdfSignatures(
  pdf: Uint8Array,
  trust: TrustStore,
  now: Date,
  options: VerifyOptions = {},
): Promise<SignatureReport> {
  const bytes = Buffer.from(pdf);
  const text = bytes.toString('latin1');
  const { found, hasDss } = locate(text);
  const context: Context = { layout: { text, bytes, ends: revisionEnds(text), hasDss }, trust, now, options };
  const signatures: SignatureResult[] = [];
  for (const located of found) signatures.push(await verifyOne(context, located, signatures.length));
  upgradeProfiles(signatures);
  checkOrder(signatures);
  return {
    overall: overallOf(signatures, options.policy ?? 'STRICT'),
    verifiedAt: now,
    verifierVersion: VERIFIER_VERSION,
    signatures,
  };
}
