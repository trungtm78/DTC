import { X509Certificate } from 'node:crypto';
import { DomainError } from './errors.ts';

/** What the registry keeps of a public signing certificate (ADM-08): identifiers and validity, never key material. */
export interface ParsedCertificate {
  /** Serial number, upper-case hexadecimal as the certificate authority issued it. */
  serial: string;
  issuerDn: string;
  subjectDn: string;
  validFrom: Date;
  validUntil: Date;
  /** SHA-256 of the DER certificate, 64 lower-case hexadecimal characters: unique per tenant. */
  fingerprintSha256: string;
}

const MAX_TEXT_LENGTH = 20_000;
const FIELD = 'certificate_pem';
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const PEM_BLOCK_LABEL = /-----BEGIN ([A-Z0-9 ]+)-----/g;
const BASE64_TEXT = /^[A-Za-z0-9+/=\s]+$/;

function invalid(detail: string = FIELD): DomainError {
  // The detail names the field, never a value: a rejected file may hold a private key.
  return new DomainError('CERTIFICATE_INVALID', 422, detail);
}

function labelsOf(text: string): string[] {
  return [...text.matchAll(PEM_BLOCK_LABEL)].map((match) => match[1] ?? '');
}

function certificateOf(text: string): X509Certificate {
  const labels = labelsOf(text);
  try {
    if (labels.length === 0) {
      if (!BASE64_TEXT.test(text)) throw invalid();
      return new X509Certificate(Buffer.from(text.replace(/\s+/g, ''), 'base64'));
    }
    return new X509Certificate(text);
  } catch {
    // Node's parser errors can quote input: only the fact that the text is not a certificate leaves this module.
    throw invalid();
  }
}

function dateOf(certificateDate: Date | undefined, text: string): Date {
  return certificateDate ?? new Date(text);
}

/**
 * Parses one public X.509 certificate (PEM, or the base64 of its DER) and checks that it can be registered at `now`.
 * It refuses anything that carries private key material before it parses, so a mistaken upload is never stored.
 * Failures are 422 CERTIFICATE_INVALID (not a certificate, a key, a bundle, not valid yet) or CERTIFICATE_EXPIRED.
 */
export function parseSigningCertificate(text: string, now: Date): ParsedCertificate {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LENGTH) throw invalid();
  if (PRIVATE_KEY_BLOCK.test(text)) throw invalid();
  const labels = labelsOf(text);
  if (labels.some((label) => label !== 'CERTIFICATE')) throw invalid();
  if (labels.length > 1) throw invalid();
  const certificate = certificateOf(text);
  const validFrom = dateOf(certificate.validFromDate, certificate.validFrom);
  const validUntil = dateOf(certificate.validToDate, certificate.validTo);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || validFrom >= validUntil) throw invalid();
  if (now >= validUntil) throw new DomainError('CERTIFICATE_EXPIRED', 422, 'valid_until');
  if (now < validFrom) throw invalid('valid_from');
  return {
    serial: certificate.serialNumber.toUpperCase(),
    issuerDn: certificate.issuer.replace(/\n/g, ', '),
    subjectDn: certificate.subject.replace(/\n/g, ', '),
    validFrom,
    validUntil,
    fingerprintSha256: certificate.fingerprint256.replace(/:/g, '').toLowerCase(),
  };
}
