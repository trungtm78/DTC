import { canonicalJson, sha256Hex } from './canonical-json.ts';
import type { LayoutProfile } from './pdf-layout.ts';

const SIXTEEN_BYTES_AS_HEX = 32;

/** A decimal string without an exponent for a finite number (BR-DOC-11 writes numbers as decimal strings). */
function decimalString(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('payload numbers must be finite');
  const plain = String(value);
  if (!plain.includes('e')) return plain;
  const [mantissa = '', exponentText = '0'] = plain.split('e');
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const [integerPart = '', fraction = ''] = mantissa.replace('-', '').split('.');
  const digits = integerPart + fraction;
  const pointAt = integerPart.length + exponent;
  const text =
    pointAt <= 0
      ? `0.${'0'.repeat(-pointAt)}${digits}`
      : pointAt >= digits.length
        ? `${digits}${'0'.repeat(pointAt - digits.length)}`
        : `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return negative ? `-${trimmed}` : trimmed;
}

/**
 * BR-DOC-11: the normalised payload has sorted keys (done by the canonical writer), numbers as decimal strings and
 * strings in Unicode NFC; `undefined` members are dropped.
 */
export function normalisePayload(value: unknown): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'number') return decimalString(value);
  if (Array.isArray(value)) return value.map((item) => normalisePayload(item));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (member !== undefined) result[key.normalize('NFC')] = normalisePayload(member);
    }
    return result;
  }
  throw new TypeError(`payload member of type ${typeof value} is not data`);
}

/** `payload_sha256` of BR-DOC-11: SHA-256 of the canonical bytes of the normalised payload. */
export function payloadSha256(payload: unknown): string {
  return sha256Hex(canonicalJson(normalisePayload(payload)));
}

/** Everything that decides the bytes of a rendered PDF (F14); equal input gives equal bytes. */
export interface RenderInput {
  templateContentSha256: string;
  templateRevision: number;
  layout: LayoutProfile;
  payload: unknown;
  asOfDate: string;
  rendererVersion: string;
  watermarkText: string | null;
}

/** The SHA-256 over the whole render input: it also fixes the document id of the PDF. */
export function renderInputHash(input: RenderInput): string {
  return sha256Hex(canonicalJson({ ...input, payload: normalisePayload(input.payload) }));
}

/** The /ID of the PDF: the first 16 bytes of the input hash as hex (F14: no clock, no randomness). */
export function documentIdOf(inputHash: string): string {
  return inputHash.slice(0, SIXTEEN_BYTES_AS_HEX);
}

/** One block of a template body after the placeholders are filled. */
export interface RenderBlock {
  kind: 'heading' | 'paragraph';
  text: string;
}

/** What a renderer draws: the fixed parts of a state document and the body blocks. */
export interface RenderContent {
  parentAgency: string | null;
  agency: string;
  docTypeName: string;
  /** The number line ("No: ..."): empty while the number is still to be assigned. */
  numberText: string;
  placeDate: string;
  summary: string | null;
  blocks: RenderBlock[];
  signerTitle: string | null;
  signerName: string | null;
  recipients: string[];
}

export interface RenderRequest {
  layout: LayoutProfile;
  content: RenderContent;
  /** `CreationDate` of the PDF: 00:00 +07:00 of the as-of date, never the current time. */
  asOfDate: string;
  inputHash: string;
  watermarkText: string | null;
}

export interface RenderedPdf {
  bytes: Uint8Array;
  sha256: string;
  rendererVersion: string;
  fontSubstitute: string | null;
  pageCount: number;
}

/** The rendering port: deterministic, no clock, no randomness, no network. The adapter is bound in the API. */
export interface PdfRenderer {
  readonly rendererVersion: string;
  render(request: RenderRequest): Promise<RenderedPdf>;
}
