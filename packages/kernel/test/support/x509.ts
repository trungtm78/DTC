import { createSign, generateKeyPairSync } from 'node:crypto';

// A tiny DER encoder: enough to build a self-signed X.509 certificate with a chosen validity window in the test, so no
// binary fixture and no external tool is needed.
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length =
    body.length < 128
      ? Buffer.from([body.length])
      : body.length < 256
        ? Buffer.from([0x81, body.length])
        : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}
const oid = (bytes: number[]): Buffer => der(0x06, Buffer.from(bytes));
const utf8 = (text: string): Buffer => der(0x0c, Buffer.from(text, 'utf8'));
const int = (value: number): Buffer => der(0x02, Buffer.from([value]));
const utcTime = (date: Date): Buffer => der(0x17, Buffer.from(`${date.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`, 'ascii'));
const CN = [0x55, 0x04, 0x03];
const ECDSA_SHA256 = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02];

function name(commonName: string): Buffer {
  return der(0x30, der(0x31, der(0x30, oid(CN), utf8(commonName))));
}

export interface CertificateOptions {
  subject?: string;
  issuer?: string;
  validFrom: Date;
  validUntil: Date;
  serial?: number;
}

export function certificatePem(options: CertificateOptions): string {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const signatureAlgorithm = der(0x30, oid(ECDSA_SHA256));
  const tbs = der(
    0x30,
    der(0xa0, int(2)),
    int(options.serial ?? 7),
    signatureAlgorithm,
    name(options.issuer ?? 'Test CA'),
    der(0x30, utcTime(options.validFrom), utcTime(options.validUntil)),
    name(options.subject ?? 'Nguyen Van A'),
    spki,
  );
  const signature = createSign('SHA256').update(tbs).sign(privateKey);
  const certificate = der(0x30, tbs, signatureAlgorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const base64 = certificate.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}
