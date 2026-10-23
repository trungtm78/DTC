import { createHash } from 'node:crypto';
import { appendRevision, describePdf, serializeValue } from '../../../src/modules/doc/pdf-incremental';
import type { RevisionObject } from '../../../src/modules/doc/pdf-incremental';
import { signDigest } from '../../../src/modules/doc/mock-pki';
import type { Identity, TimestampSource } from '../../../src/modules/doc/mock-pki';
import { dictionaryOf } from '../../../src/modules/doc/pdf-objects';
import type { PdfValue } from '../../../src/modules/doc/pdf-objects';
import { embedSignature, prepareSignature, signedBytesOf } from '../../../src/modules/doc/pdf-signing';

const HEADER = '%PDF-1.7\n%âãÏÓ\n';
const WIDGET = '/Type /Annot /Subtype /Widget /P 3 0 R /F 4';

function textField(name: string, row: number): string {
  return `<< ${WIDGET} /FT /Tx /T (${name}) /Rect [72 ${700 - row * 30} 272 ${720 - row * 30}] /DA (/F1 10 Tf 0 g) >>`;
}

function signatureField(name: string, row: number): string {
  return `<< ${WIDGET} /FT /Sig /T (${name}) /Rect [72 ${400 - row * 60} 272 ${450 - row * 60}] >>`;
}

export interface FixtureOptions {
  /** An additional empty signature field, used as the carrier of a document timestamp. */
  timestampField?: boolean;
  /** Keep the annotation list of the page in an object of its own (object 13), as many writers do. */
  indirectAnnotations?: boolean;
}

/** Revision 0 of BR-DOC-14 a: PDF 1.7 with the three empty number fields and the two signature fields. */
export function revisionZero(options: FixtureOptions = {}): Buffer {
  const fields = [6, 7, 8, 9, 10, ...(options.timestampField === true ? [12] : [])];
  const refs = fields.map((num) => `${num} 0 R`).join(' ');
  const bodies = new Map<number, string>([
    [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Annots ${options.indirectAnnotations === true ? "13 0 R" : `[${refs}]`} /Resources << /Font << /F1 11 0 R >> >> >>`],
    [4, '<< /Length 36 >>\nstream\nBT /F1 12 Tf 72 780 Td (Hello) Tj ET\nendstream'],
    [5, `<< /Fields [${refs}] /SigFlags 3 /DA (/F1 0 Tf 0 g) >>`],
    [6, textField('doc_number', 0)],
    [7, textField('doc_symbol', 1)],
    [8, textField('doc_date', 2)],
    [9, signatureField('sig_leader', 0)],
    [10, signatureField('sig_org', 1)],
    [11, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    ...(options.timestampField === true ? [[12, signatureField('doc_timestamp', 2)] as [number, string]] : []),
    ...(options.indirectAnnotations === true ? [[13, `[${refs}]`] as [number, string]] : []),
  ]);
  let text = HEADER;
  const offsets = new Map<number, number>();
  for (const [num, body] of bodies) {
    offsets.set(num, Buffer.byteLength(text, 'latin1'));
    text += `${num} 0 obj\n${body}\nendobj\n`;
  }
  const size = Math.max(...bodies.keys()) + 1;
  const xrefAt = Buffer.byteLength(text, 'latin1');
  text += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let num = 1; num < size; num += 1) text += `${String(offsets.get(num)).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(text, 'latin1');
}

function dictionaryEntries(pdf: Uint8Array, num: number): Map<string, PdfValue> {
  const dictionary = dictionaryOf(describePdf(pdf).objects.get(num));
  if (dictionary === null) throw new Error(`object ${num} is not a dictionary`);
  return new Map(dictionary);
}

function replaced(pdf: Uint8Array, num: number, entries: Record<string, PdfValue>): RevisionObject {
  const dictionary = dictionaryEntries(pdf, num);
  for (const [key, value] of Object.entries(entries)) dictionary.set(key, value);
  return { num, body: serializeValue({ t: 'dict', v: dictionary }) };
}

const NUMBER_FIELDS: Record<string, number> = { doc_number: 6, doc_symbol: 7, doc_date: 8 };

/** The numbering revision of BR-DOC-14 c: only the value and display of the three fields change. */
export function withNumbering(pdf: Uint8Array, values: { doc_number: string; doc_symbol: string; doc_date: string }): Buffer {
  const base = describePdf(pdf).size;
  const updates: RevisionObject[] = [];
  Object.entries(NUMBER_FIELDS).forEach(([name, num], position) => {
    const appearance = base + position;
    const value = values[name as keyof typeof values];
    const content = `BT /F1 10 Tf 2 5 Td (${value}) Tj ET`;
    updates.push({
      num: appearance,
      body: `<< /Type /XObject /Subtype /Form /BBox [0 0 200 20] /Length ${content.length} >>\nstream\n${content}\nendstream`,
    });
    updates.push(
      replaced(pdf, num, {
        V: { t: 'str', v: value },
        AP: { t: 'dict', v: new Map<string, PdfValue>([['N', { t: 'ref', obj: appearance, gen: 0 }]]) },
      }),
    );
  });
  return appendRevision(pdf, updates).pdf;
}

export interface SignOptions {
  field: string;
  identity: Identity;
  signingTime: Date;
  timestamps?: TimestampSource;
  docMdpLevel?: 1 | 2 | 3;
  essHash?: 'sha256' | 'sha384';
}

/** Signs a field the way the signing port does: the signer receives the hash of the covered bytes, nothing else. */
export async function signField(pdf: Uint8Array, options: SignOptions): Promise<Buffer> {
  const prepared = prepareSignature(pdf, {
    fieldName: options.field,
    signingTime: options.signingTime,
    ...(options.docMdpLevel === undefined ? {} : { docMdpLevel: options.docMdpLevel }),
  });
  const digest = createHash('sha256').update(signedBytesOf(prepared)).digest();
  const cms = await signDigest({
    identity: options.identity,
    digest,
    signingTime: options.signingTime,
    ...(options.timestamps === undefined ? {} : { timestamps: options.timestamps }),
    ...(options.essHash === undefined ? {} : { essHash: options.essHash }),
  });
  return embedSignature(prepared, cms);
}

/** A document timestamp over the whole file, written into the field `doc_timestamp`. */
export async function stampDocument(pdf: Uint8Array, authority: TimestampSource, at: Date): Promise<Buffer> {
  const prepared = prepareSignature(pdf, { fieldName: 'doc_timestamp', signingTime: at, documentTimestamp: true });
  const token = await authority.stamp(createHash('sha256').update(signedBytesOf(prepared)).digest());
  return embedSignature(prepared, token);
}

/** A DSS revision (BR-DOC-14 e): validation data added after the signatures, with no other change. */
export function withValidationData(pdf: Uint8Array, certificates: readonly Buffer[]): Buffer {
  const base = describePdf(pdf).size;
  const updates: RevisionObject[] = certificates.map((certificate, position) => ({
    num: base + 1 + position,
    body: `<< /Length ${certificate.length} >>\nstream\n${certificate.toString('latin1')}\nendstream`,
  }));
  const refs = certificates.map((_, position) => `${base + 1 + position} 0 R`).join(' ');
  updates.push({ num: base, body: `<< /Certs [${refs}] >>` });
  updates.push(replaced(pdf, 1, { DSS: { t: 'ref', obj: base, gen: 0 } }));
  return appendRevision(pdf, updates).pdf;
}
