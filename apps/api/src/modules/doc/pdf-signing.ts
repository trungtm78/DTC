import { appendRevision, describePdf, PdfStructureError, serializeValue } from './pdf-incremental.ts';
import type { RevisionObject } from './pdf-incremental.ts';
import { dictionaryOf, nameOf, textOf } from './pdf-objects.ts';
import type { PdfValue } from './pdf-objects.ts';

/** Room kept for the CMS signature: a CMS with a certificate chain and a timestamp token stays well below it. */
export const DEFAULT_RESERVED_BYTES = 16_384;

export interface SignatureRequest {
  /** The signature field to fill, for example `sig_leader` or `sig_org`. */
  fieldName: string;
  signingTime: Date;
  /** A document timestamp (RFC 3161 token) instead of a CMS signature; it never certifies the document. */
  documentTimestamp?: boolean;
  /** DocMDP permission level; when set the signature certifies the document (BR-DOC-14 b). */
  docMdpLevel?: 1 | 2 | 3;
  reservedBytes?: number;
}

export interface PreparedSignature {
  /** The file with the signature revision appended and the `Contents` placeholder still zero. */
  pdf: Buffer;
  /** `[0, start of Contents, end of Contents, rest]`: the bytes the signature covers. */
  byteRange: [number, number, number, number];
  contentsStart: number;
  contentsEnd: number;
}

const BYTE_RANGE_DIGITS = 10;

function pdfDate(date: Date): string {
  return `D:${date.toISOString().slice(0, 19).replace(/[-:T]/g, '')}Z`;
}

function fieldNumberOf(objects: ReadonlyMap<number, PdfValue>, fieldName: string): number {
  for (const [num, value] of objects) {
    const dictionary = dictionaryOf(value);
    if (nameOf(dictionary?.get('FT')) === 'Sig' && textOf(dictionary?.get('T')) === fieldName) return num;
  }
  throw new PdfStructureError(`signature field ${fieldName} not found`);
}

function referenceDictionary(level: number): string {
  return `/Reference [<< /Type /SigRef /TransformMethod /DocMDP /TransformParams << /Type /TransformParams /P ${level} /V /1.2 >> >>]`;
}

function withEntries(value: PdfValue | undefined, entries: Record<string, PdfValue>): string | null {
  const dictionary = dictionaryOf(value);
  if (dictionary === null) return null;
  return serializeValue({ t: 'dict', v: new Map([...dictionary, ...Object.entries(entries)]) });
}

/** The coverage of a prepared signature: everything except the `Contents` value. */
export function signedBytesOf(prepared: PreparedSignature): Buffer {
  const [, first, second] = prepared.byteRange;
  return Buffer.concat([prepared.pdf.subarray(0, first), prepared.pdf.subarray(second)]);
}

/**
 * Appends the incremental update that carries an empty signature in the named field and fixes its `ByteRange`. The
 * bytes of the earlier revisions are never touched. The caller hashes `signedBytesOf`, gets a CMS from the signing
 * port (which only ever sees the hash) and calls `embedSignature`.
 */
export function prepareSignature(pdf: Uint8Array, request: SignatureRequest): PreparedSignature {
  const state = describePdf(pdf);
  const fieldNum = fieldNumberOf(state.objects, request.fieldName);
  const field = dictionaryOf(state.objects.get(fieldNum));
  if (field === null || field.has('V')) throw new PdfStructureError(`signature field ${request.fieldName} is already signed`);
  const signatureNum = state.size;
  const reserved = request.reservedBytes ?? DEFAULT_RESERVED_BYTES;
  const zeros = '0'.repeat(BYTE_RANGE_DIGITS);
  const head =
    request.documentTimestamp === true
      ? '/Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161'
      : '/Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached';
  const signature =
    `<< ${head} /ByteRange [0 ${zeros} ${zeros} ${zeros}] /Contents <${'0'.repeat(reserved * 2)}> ` +
    `/M (${pdfDate(request.signingTime)}) ${request.docMdpLevel === undefined ? '' : referenceDictionary(request.docMdpLevel)} >>`;
  const updates: RevisionObject[] = [
    { num: signatureNum, body: signature },
    { num: fieldNum, body: withEntries(state.objects.get(fieldNum), { V: { t: 'ref', obj: signatureNum, gen: 0 } }) ?? '' },
  ];
  if (request.docMdpLevel !== undefined) {
    const rootRef = state.trailer.get('Root');
    const rootNum = rootRef?.t === 'ref' ? rootRef.obj : null;
    const catalog = rootNum === null ? undefined : state.objects.get(rootNum);
    const perms: PdfValue = {
      t: 'dict',
      v: new Map([['DocMDP', { t: 'ref', obj: signatureNum, gen: 0 } as PdfValue]]),
    };
    const body = withEntries(catalog, { Perms: perms });
    if (rootNum === null || body === null) throw new PdfStructureError('the file has no catalog');
    updates.push({ num: rootNum, body });
  }
  const appended = appendRevision(pdf, updates);
  const text = appended.pdf.toString('latin1');
  const objectStart = appended.offsets.get(signatureNum) ?? 0;
  const byteRangeAt = text.indexOf('/ByteRange [', objectStart);
  const contentsAt = text.indexOf('/Contents <', objectStart);
  const contentsStart = contentsAt + '/Contents '.length;
  const contentsEnd = contentsStart + 1 + reserved * 2 + 1;
  const byteRange: [number, number, number, number] = [0, contentsStart, contentsEnd, appended.pdf.length - contentsEnd];
  const patched = `/ByteRange [0 ${String(byteRange[1]).padStart(BYTE_RANGE_DIGITS, '0')} ${String(byteRange[2]).padStart(BYTE_RANGE_DIGITS, '0')} ${String(byteRange[3]).padStart(BYTE_RANGE_DIGITS, '0')}]`;
  const original = text.slice(byteRangeAt, text.indexOf(']', byteRangeAt) + 1);
  appended.pdf.write(patched, byteRangeAt, 'latin1');
  if (patched.length !== original.length) throw new PdfStructureError('byte range placeholder has the wrong width');
  return { pdf: appended.pdf, byteRange, contentsStart, contentsEnd };
}

/** Writes the CMS (DER) into the reserved `Contents` space, padded with zeros as readers expect. */
export function embedSignature(prepared: PreparedSignature, cms: Uint8Array): Buffer {
  const room = (prepared.contentsEnd - prepared.contentsStart - 2) / 2;
  if (cms.length > room) throw new PdfStructureError('the signature does not fit the reserved space');
  const result = Buffer.from(prepared.pdf);
  result.write(Buffer.from(cms).toString('hex').toUpperCase(), prepared.contentsStart + 1, 'latin1');
  return result;
}
