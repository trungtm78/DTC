import { X509Certificate, createHash, verify } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { allowedDigestName, isAllowedAlgorithm } from '@machvon/kernel';
import type { SignatureFinding, TrustRegime } from '@machvon/kernel';

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';
const OID_SIGNING_CERTIFICATE_V2 = '1.2.840.113549.1.9.16.2.47';
const OID_SIGNATURE_TIMESTAMP = '1.2.840.113549.1.9.16.2.14';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_EXTENDED_KEY_USAGE = '2.5.29.37';
const OID_KP_TIME_STAMPING = '1.3.6.1.5.5.7.3.8';
/** The bit of `keyCertSign` in the first byte of a KeyUsage bit string (RFC 5280, bit 5, most significant bit first). */
const KEY_CERT_SIGN_BIT = 0x04;
const MAX_CHAIN_DEPTH = 8;

export interface TrustAnchor {
  regime: TrustRegime;
  /** DER certificate of the trust anchor. */
  certificate: Buffer;
}

/** The trust anchors per regime (BR-DOC-15: configuration data per tenant, changed only with legal approval). */
export interface TrustStore {
  anchors(): readonly TrustAnchor[];
}

export type ChainOutcome =
  | { status: 'TRUSTED'; regime: TrustRegime; path: X509Certificate[] }
  | { status: 'UNTRUSTED' | 'INCOMPLETE'; regime: null; path: X509Certificate[] };

export interface CmsFacts {
  signer: X509Certificate | null;
  pool: X509Certificate[];
  declaredSigningTime: Date | null;
  /** The signature timestamp token carried as an unsigned attribute, DER. */
  timestampToken: Buffer | null;
  signatureValue: Buffer;
  findings: SignatureFinding[];
}

export interface TimestampFacts {
  genTime: Date;
  signer: X509Certificate;
  chain: ChainOutcome;
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hashOf(algorithm: string, bytes: Uint8Array): Buffer {
  return createHash(algorithm).update(bytes).digest();
}

export function fingerprintOf(certificate: X509Certificate): string {
  return hashOf('sha256', certificate.raw).toString('hex');
}

/** Length of the first DER element in `bytes`: the Contents placeholder is padded with zeros after it. */
export function derLength(bytes: Uint8Array): number | null {
  if (bytes.length < 2 || bytes[0] !== 0x30) return null;
  const first = bytes[1] ?? 0;
  if (first < 0x80) return 2 + first;
  const count = first & 0x7f;
  if (count === 0 || count > 4 || bytes.length < 2 + count) return null;
  let length = 0;
  for (let at = 0; at < count; at += 1) length = length * 256 + (bytes[2 + at] ?? 0);
  return 2 + count + length;
}

function parseSignedData(der: Uint8Array): pkijs.SignedData | null {
  try {
    const parsed = asn1js.fromBER(arrayBufferOf(der));
    if (parsed.offset === -1) return null;
    const contentInfo = new pkijs.ContentInfo({ schema: parsed.result });
    if (contentInfo.contentType !== OID_SIGNED_DATA) return null;
    return new pkijs.SignedData({ schema: contentInfo.content });
  } catch {
    // Anything the parser rejects is a malformed signature; the parser's message is not reported.
    return null;
  }
}

function embeddedCertificates(data: pkijs.SignedData): { pkijs: pkijs.Certificate; node: X509Certificate }[] {
  const result: { pkijs: pkijs.Certificate; node: X509Certificate }[] = [];
  for (const item of data.certificates ?? []) {
    if (!(item instanceof pkijs.Certificate)) continue;
    try {
      result.push({ pkijs: item, node: new X509Certificate(Buffer.from(item.toSchema(true).toBER(false))) });
    } catch {
      // A certificate Node cannot read is left out of the pool; the chain check then reports what is missing.
    }
  }
  return result;
}

function signerOf(
  info: pkijs.SignerInfo,
  certificates: { pkijs: pkijs.Certificate; node: X509Certificate }[],
): X509Certificate | null {
  const sid = info.sid;
  if (!(sid instanceof pkijs.IssuerAndSerialNumber)) return null;
  const match = certificates.find(
    (candidate) => candidate.pkijs.issuer.isEqual(sid.issuer) && candidate.pkijs.serialNumber.isEqual(sid.serialNumber),
  );
  return match?.node ?? null;
}

function attributeValue(info: pkijs.SignerInfo, oid: string, unsigned = false): asn1js.BaseBlock | null {
  const set = unsigned ? info.unsignedAttrs : info.signedAttrs;
  const found = set?.attributes.find((attribute) => attribute.type === oid);
  return (found?.values[0] as asn1js.BaseBlock | undefined) ?? null;
}

function essCertificateHash(value: asn1js.BaseBlock): { algorithm: string; hash: Buffer } | null {
  if (!(value instanceof asn1js.Sequence)) return null;
  const certs = value.valueBlock.value[0];
  const first = certs instanceof asn1js.Sequence ? certs.valueBlock.value[0] : undefined;
  if (!(first instanceof asn1js.Sequence)) return null;
  let algorithm = 'sha256';
  let hash: Buffer | null = null;
  for (const element of first.valueBlock.value) {
    if (element instanceof asn1js.OctetString) hash = Buffer.from(element.valueBlock.valueHexView);
    else if (element instanceof asn1js.Sequence) {
      const oid = element.valueBlock.value[0];
      if (oid instanceof asn1js.ObjectIdentifier) algorithm = allowedDigestName(oid.valueBlock.toString()) ?? 'unsupported';
    }
  }
  return hash === null ? null : { algorithm, hash };
}

function algorithmFindings(info: pkijs.SignerInfo, signer: X509Certificate): SignatureFinding[] {
  const details = signer.publicKey.asymmetricKeyDetails;
  const allowed = isAllowedAlgorithm({
    oidSignature: info.signatureAlgorithm.algorithmId,
    oidDigest: info.digestAlgorithm.algorithmId,
    keyType: signer.publicKey.asymmetricKeyType,
    ...(details?.modulusLength === undefined ? {} : { rsaBits: details.modulusLength }),
    ...(details?.namedCurve === undefined ? {} : { curve: details.namedCurve }),
  });
  return allowed ? [] : ['ALGORITHM_NOT_ALLOWED'];
}

/**
 * Checks one CMS signature against the content it covers: signer found, algorithm allowed, `messageDigest` equal to the
 * digest of `content`, signed attributes signed by the signer's key, certificate binding (`signingCertificate-v2`).
 */
export function checkCms(der: Uint8Array, content: Uint8Array, mismatch: SignatureFinding): CmsFacts {
  const empty: CmsFacts = {
    signer: null,
    pool: [],
    declaredSigningTime: null,
    timestampToken: null,
    signatureValue: Buffer.alloc(0),
    findings: ['SIGNATURE_MALFORMED'],
  };
  const data = parseSignedData(der);
  const info = data?.signerInfos[0];
  if (data === null || info === undefined || info.signedAttrs === undefined) return empty;
  const certificates = embeddedCertificates(data);
  const signer = signerOf(info, certificates);
  const facts: CmsFacts = {
    ...empty,
    signer,
    pool: certificates.map((entry) => entry.node),
    signatureValue: Buffer.from(info.signature.valueBlock.valueHexView),
    findings: [],
  };
  if (signer === null) return { ...facts, findings: ['SIGNATURE_MALFORMED'] };
  const digestName = allowedDigestName(info.digestAlgorithm.algorithmId);
  const algorithm = algorithmFindings(info, signer);
  if (digestName === null || algorithm.length > 0) return { ...facts, findings: ['ALGORITHM_NOT_ALLOWED'] };

  const messageDigest = attributeValue(info, OID_MESSAGE_DIGEST);
  const expected = hashOf(digestName, content);
  const declared = messageDigest instanceof asn1js.OctetString ? Buffer.from(messageDigest.valueBlock.valueHexView) : null;
  if (declared === null) return { ...facts, findings: ['SIGNATURE_MALFORMED'] };
  if (!declared.equals(expected)) facts.findings.push(mismatch);

  const signedAttributes = Buffer.from(info.signedAttrs.encodedValue);
  if (!verify(digestName, signedAttributes, signer.publicKey, facts.signatureValue)) facts.findings.push('SIGNATURE_INVALID');

  const binding = attributeValue(info, OID_SIGNING_CERTIFICATE_V2);
  const ess = binding === null ? null : essCertificateHash(binding);
  const bindingDigest = ess === null || ess.algorithm === 'unsupported' ? null : hashOf(ess.algorithm, signer.raw);
  if (ess === null || bindingDigest === null || !bindingDigest.equals(ess.hash)) facts.findings.push('SIGNER_CERTIFICATE_MISMATCH');

  const signingTime = attributeValue(info, OID_SIGNING_TIME);
  if (signingTime instanceof asn1js.UTCTime || signingTime instanceof asn1js.GeneralizedTime) {
    facts.declaredSigningTime = signingTime.toDate();
  }
  const token = attributeValue(info, OID_SIGNATURE_TIMESTAMP, true);
  if (token !== null) facts.timestampToken = Buffer.from(token.toBER(false));
  return facts;
}

function certificateObject(certificate: X509Certificate): pkijs.Certificate | null {
  try {
    return new pkijs.Certificate({ schema: asn1js.fromBER(arrayBufferOf(certificate.raw)).result });
  } catch {
    // A certificate pkijs cannot read has no constraints we can honour: callers treat it as unusable.
    return null;
  }
}

function extensionOf(certificate: pkijs.Certificate, oid: string): pkijs.Extension | undefined {
  return certificate.extensions?.find((extension) => extension.extnID === oid);
}

/**
 * Whether a certificate may sign a RFC 3161 token (section 2.3): the extended key usage extension must be present,
 * critical, and list `id-kp-timeStamping` as its only purpose. An ordinary signing certificate must never fix a time.
 */
export function isTimestampAuthority(certificate: X509Certificate): boolean {
  const parsed = certificateObject(certificate);
  const extension = parsed === null ? undefined : extensionOf(parsed, OID_EXTENDED_KEY_USAGE);
  if (extension === undefined || extension.critical !== true) return false;
  const purposes = (extension.parsedValue as pkijs.ExtKeyUsage | undefined)?.keyPurposes;
  return purposes !== undefined && purposes.length === 1 && purposes[0] === OID_KP_TIME_STAMPING;
}

interface IssuingLimits {
  /** True when the key usage extension, if present, allows signing certificates. */
  mayIssue: boolean;
  /** `pathLenConstraint`: how many intermediate authorities may stand below this one, or null when unlimited. */
  pathLength: number | null;
}

function issuingLimitsOf(certificate: X509Certificate): IssuingLimits | null {
  const parsed = certificateObject(certificate);
  if (parsed === null) return null;
  const constraints = extensionOf(parsed, OID_BASIC_CONSTRAINTS)?.parsedValue as pkijs.BasicConstraints | undefined;
  const usage = extensionOf(parsed, OID_KEY_USAGE)?.parsedValue as asn1js.BitString | undefined;
  const mayIssue = usage === undefined || ((new Uint8Array(usage.valueBlock.valueHexView)[0] ?? 0) & KEY_CERT_SIGN_BIT) !== 0;
  const limit = constraints?.pathLenConstraint;
  return { mayIssue, pathLength: limit instanceof asn1js.Integer ? limit.valueBlock.valueDec : (limit ?? null) };
}

/**
 * RFC 5280 6.1.4: an authority may issue below it only when basicConstraints says it is one and keyCertSign is not ruled
 * out, and only as many intermediate authorities as its pathLenConstraint allows. `below` counts the intermediates between
 * the authority and the end-entity certificate.
 */
function mayIssueAbove(authority: X509Certificate, below: number): boolean {
  const limits = issuingLimitsOf(authority);
  return limits !== null && authority.ca && limits.mayIssue && (limits.pathLength === null || below <= limits.pathLength);
}

function isSelfSigned(certificate: X509Certificate): boolean {
  return certificate.subject === certificate.issuer && certificate.verify(certificate.publicKey);
}

/** Builds the path from `signer` to a trust anchor using the embedded certificates and the anchors. */
export function buildChain(signer: X509Certificate, pool: readonly X509Certificate[], anchors: readonly TrustAnchor[]): ChainOutcome {
  const anchorCertificates = anchors.map((anchor) => ({ regime: anchor.regime, certificate: new X509Certificate(anchor.certificate) }));
  const path: X509Certificate[] = [signer];
  for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
    const current = path[path.length - 1] as X509Certificate;
    const anchor = anchorCertificates.find((entry) => entry.certificate.raw.equals(current.raw));
    if (anchor !== undefined) return { status: 'TRUSTED', regime: anchor.regime, path };
    // Intermediates between the end-entity certificate and the authority that issues `current`'s successor: all but the leaf.
    const below = path.length - 1;
    const issuingAnchor = anchorCertificates.find(
      (entry) => entry.certificate.ca && current.checkIssued(entry.certificate) && current.verify(entry.certificate.publicKey),
    );
    if (issuingAnchor !== undefined) {
      const extended = [...path, issuingAnchor.certificate];
      return mayIssueAbove(issuingAnchor.certificate, below)
        ? { status: 'TRUSTED', regime: issuingAnchor.regime, path: extended }
        : { status: 'UNTRUSTED', regime: null, path: extended };
    }
    const issuer = pool.find(
      (candidate) => candidate.ca && !path.includes(candidate) && current.checkIssued(candidate) && current.verify(candidate.publicKey),
    );
    if (issuer === undefined) {
      return { status: isSelfSigned(current) ? 'UNTRUSTED' : 'INCOMPLETE', regime: null, path };
    }
    if (!mayIssueAbove(issuer, below)) return { status: 'UNTRUSTED', regime: null, path: [...path, issuer] };
    path.push(issuer);
  }
  return { status: 'INCOMPLETE', regime: null, path };
}

/** Whether every certificate of the path is inside its validity period at `at`. */
export function validAt(path: readonly X509Certificate[], at: Date): boolean {
  return path.every((certificate) => certificate.validFromDate <= at && at <= certificate.validToDate);
}

/**
 * Verifies an RFC 3161 token: it is a CMS over a TSTInfo, the TSTInfo carries the imprint of `imprinted`, and the
 * timestamp authority chains to a trust anchor and was valid at the time it states. Returns null when it fails.
 */
export function checkTimestampToken(token: Uint8Array, imprinted: Uint8Array, anchors: readonly TrustAnchor[]): TimestampFacts | null {
  const data = parseSignedData(token);
  const content = data?.encapContentInfo.eContent;
  if (data === null || content === undefined) return null;
  const tstBytes = Buffer.from(content.getValue());
  const facts = checkCms(token, tstBytes, 'TIMESTAMP_INVALID');
  if (facts.signer === null || facts.findings.length > 0) return null;
  if (!isTimestampAuthority(facts.signer)) return null;
  let info: pkijs.TSTInfo;
  try {
    info = new pkijs.TSTInfo({ schema: asn1js.fromBER(arrayBufferOf(tstBytes)).result });
  } catch {
    // A TSTInfo that does not parse means the token proves nothing.
    return null;
  }
  const digestName = allowedDigestName(info.messageImprint.hashAlgorithm.algorithmId);
  if (digestName === null) return null;
  const imprint = Buffer.from(info.messageImprint.hashedMessage.valueBlock.valueHexView);
  if (!imprint.equals(hashOf(digestName, imprinted))) return null;
  const chain = buildChain(facts.signer, facts.pool, anchors);
  if (chain.status !== 'TRUSTED' || !validAt(chain.path, info.genTime)) return null;
  return { genTime: info.genTime, signer: facts.signer, chain };
}

/** The `messageDigest` a CMS signs, or null when the CMS cannot be read: what a signer was asked to sign. */
export function signedDigestOf(der: Uint8Array): Buffer | null {
  const info = parseSignedData(der)?.signerInfos[0];
  const value = info === undefined ? null : attributeValue(info, OID_MESSAGE_DIGEST);
  return value instanceof asn1js.OctetString ? Buffer.from(value.valueBlock.valueHexView) : null;
}
