import { createHash, webcrypto } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

// A small public-key infrastructure for tests and for the MOCK signing adapter: it issues certificates, signs a hash
// the way a certification authority does (PAdES-B-B, optionally with an RFC 3161 signature timestamp) and acts as a
// timestamp authority. Private keys never leave the process and are never serialised.

export const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signatureTimestampToken: '1.2.840.113549.1.9.16.2.14',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  basicConstraints: '2.5.29.19',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
} as const;

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

export type KeyType = 'ec' | 'rsa' | 'rsa-1024';

export interface Identity {
  certificate: Buffer;
  privateKey: CryptoKey;
  /** Intermediate certificates between the certificate and the root (root excluded), nearest issuer first. */
  chain: Buffer[];
}

export interface IssueOptions {
  commonName: string;
  organization?: string;
  notBefore: Date;
  notAfter: Date;
  keyType?: KeyType;
  /** The certificate may itself issue certificates. */
  ca?: boolean;
}

const subtle = webcrypto.subtle;

function arrayBufferOf(buffer: Uint8Array): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function generateKeyPair(keyType: KeyType): Promise<CryptoKeyPair> {
  if (keyType === 'ec') return subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const modulusLength = keyType === 'rsa' ? 2048 : 1024;
  return subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
}

function nameOf(commonName: string, organization: string | undefined): pkijs.RelativeDistinguishedNames {
  const name = new pkijs.RelativeDistinguishedNames();
  if (organization !== undefined) {
    name.typesAndValues.push(
      new pkijs.AttributeTypeAndValue({ type: OID.organization, value: new asn1js.Utf8String({ value: organization }) }),
    );
  }
  name.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: commonName }) }),
  );
  return name;
}

let nextSerial = 1000;

async function buildCertificate(
  options: IssueOptions,
  subjectKeys: CryptoKeyPair,
  issuer: { name: pkijs.RelativeDistinguishedNames; privateKey: CryptoKey },
): Promise<Buffer> {
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  nextSerial += 1;
  certificate.serialNumber = new asn1js.Integer({ value: nextSerial });
  certificate.issuer.typesAndValues.push(...issuer.name.typesAndValues);
  certificate.subject.typesAndValues.push(...nameOf(options.commonName, options.organization).typesAndValues);
  certificate.notBefore.value = options.notBefore;
  certificate.notAfter.value = options.notAfter;
  certificate.extensions = [
    new pkijs.Extension({
      extnID: OID.basicConstraints,
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: options.ca === true }).toSchema().toBER(false),
    }),
  ];
  await certificate.subjectPublicKeyInfo.importKey(subjectKeys.publicKey);
  await certificate.sign(issuer.privateKey, 'SHA-256');
  return Buffer.from(certificate.toSchema(true).toBER(false));
}

function parsedName(der: Buffer): pkijs.RelativeDistinguishedNames {
  const parsed = asn1js.fromBER(arrayBufferOf(der));
  return new pkijs.Certificate({ schema: parsed.result }).subject;
}

/** A certification authority: a self-signed root, or an intermediate made from an identity this authority issued. */
export class MockCertificateAuthority {
  private constructor(
    /** The certificate of this authority. */
    readonly certificate: Buffer,
    private readonly privateKey: CryptoKey,
    private readonly chainAbove: Buffer[],
    private readonly root: boolean,
  ) {}

  static async createRoot(options: Omit<IssueOptions, 'ca'>): Promise<MockCertificateAuthority> {
    const keys = await generateKeyPair(options.keyType ?? 'ec');
    const name = nameOf(options.commonName, options.organization);
    const certificate = await buildCertificate({ ...options, ca: true }, keys, { name, privateKey: keys.privateKey });
    return new MockCertificateAuthority(certificate, keys.privateKey, [], true);
  }

  /** An authority below this one: the certificate of the new authority is issued by this authority. */
  async createIntermediate(options: Omit<IssueOptions, 'ca'>): Promise<MockCertificateAuthority> {
    const identity = await this.issue({ ...options, ca: true });
    return new MockCertificateAuthority(identity.certificate, identity.privateKey, identity.chain, false);
  }

  async issue(options: IssueOptions): Promise<Identity> {
    const keys = await generateKeyPair(options.keyType ?? 'ec');
    const certificate = await buildCertificate(options, keys, {
      name: parsedName(this.certificate),
      privateKey: this.privateKey,
    });
    return { certificate, privateKey: keys.privateKey, chain: this.root ? [] : [this.certificate, ...this.chainAbove] };
  }
}

function sha256(data: Uint8Array): Buffer {
  return createHash('sha256').update(data).digest();
}

function attribute(type: string, value: asn1js.AsnType): pkijs.Attribute {
  return new pkijs.Attribute({ type, values: [value] });
}

/** The ESSCertIDv2 binding of the signer certificate; the default algorithm SHA-256 is left out as DER requires. */
function signingCertificateV2(certificate: Buffer, algorithm: 'sha256' | 'sha384' = 'sha256'): asn1js.Sequence {
  const hash = createHash(algorithm).update(certificate).digest();
  const identifier =
    algorithm === 'sha256'
      ? []
      : [new asn1js.Sequence({ value: [new asn1js.ObjectIdentifier({ value: OID.sha384 })] })];
  return new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [new asn1js.Sequence({ value: [...identifier, new asn1js.OctetString({ valueHex: arrayBufferOf(hash) })] })],
      }),
    ],
  });
}

function certificateObject(der: Buffer): pkijs.Certificate {
  return new pkijs.Certificate({ schema: asn1js.fromBER(arrayBufferOf(der)).result });
}

function contentInfoOf(signedData: pkijs.SignedData): Buffer {
  const contentInfo = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
  return Buffer.from(contentInfo.toSchema().toBER(false));
}

async function signedData(
  identity: Identity,
  eContentType: string,
  eContent: Buffer | null,
  attributes: pkijs.Attribute[],
): Promise<pkijs.SignedData> {
  const leaf = certificateObject(identity.certificate);
  const data = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType,
      ...(eContent === null ? {} : { eContent: new asn1js.OctetString({ valueHex: arrayBufferOf(eContent) }) }),
    }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: leaf.issuer, serialNumber: leaf.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes }),
      }),
    ],
    certificates: [leaf, ...identity.chain.map((der) => certificateObject(der))],
  });
  await data.sign(identity.privateKey, 0, 'SHA-256');
  return data;
}

export interface TimestampSource {
  /** An RFC 3161 token (DER ContentInfo) over `imprint`, a SHA-256 digest. */
  stamp(imprint: Buffer): Promise<Buffer>;
}

/** A timestamp authority: signs a TSTInfo with the time it is given, which tests choose. */
export class MockTimestampAuthority implements TimestampSource {
  constructor(
    private readonly identity: Identity,
    private readonly clock: () => Date,
    /** Content to sign instead of a TSTInfo: a deliberately broken token for negative tests. */
    private readonly brokenContent?: Buffer,
  ) {}

  async stamp(imprint: Buffer): Promise<Buffer> {
    const info = new pkijs.TSTInfo({
      version: 1,
      policy: '1.2.3.4.5',
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256, algorithmParams: new asn1js.Null() }),
        hashedMessage: new asn1js.OctetString({ valueHex: arrayBufferOf(imprint) }),
      }),
      serialNumber: new asn1js.Integer({ value: 1 }),
      genTime: this.clock(),
    });
    const content = this.brokenContent ?? Buffer.from(info.toSchema().toBER(false));
    const data = await signedData(this.identity, OID.tstInfo, content, [
      attribute(OID.contentType, new asn1js.ObjectIdentifier({ value: OID.tstInfo })),
      attribute(OID.messageDigest, new asn1js.OctetString({ valueHex: arrayBufferOf(sha256(content)) })),
      attribute(OID.signingCertificateV2, signingCertificateV2(this.identity.certificate)),
    ]);
    return contentInfoOf(data);
  }
}

export interface CmsRequest {
  identity: Identity;
  /** SHA-256 of the signed byte range: the only thing the signer ever receives. */
  digest: Buffer;
  signingTime: Date;
  timestamps?: TimestampSource;
  /** Hash of the ESS certificate binding; SHA-384 is written with an explicit algorithm identifier. */
  essHash?: 'sha256' | 'sha384';
}

/** Signs a digest the way a certification authority does for PAdES: a detached CMS with signed attributes. */
export async function signDigest(request: CmsRequest): Promise<Buffer> {
  const attributes = [
    attribute(OID.contentType, new asn1js.ObjectIdentifier({ value: OID.data })),
    attribute(OID.signingTime, new asn1js.UTCTime({ valueDate: request.signingTime })),
    attribute(OID.messageDigest, new asn1js.OctetString({ valueHex: arrayBufferOf(request.digest) })),
    attribute(OID.signingCertificateV2, signingCertificateV2(request.identity.certificate, request.essHash)),
  ];
  const data = await signedData(request.identity, OID.data, null, attributes);
  const signerInfo = data.signerInfos[0];
  if (request.timestamps !== undefined && signerInfo !== undefined) {
    const signature = Buffer.from(signerInfo.signature.valueBlock.valueHexView);
    const token = await request.timestamps.stamp(sha256(signature));
    const parsed = asn1js.fromBER(arrayBufferOf(token));
    signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: [new pkijs.Attribute({ type: OID.signatureTimestampToken, values: [parsed.result] })],
    });
  }
  return contentInfoOf(data);
}
