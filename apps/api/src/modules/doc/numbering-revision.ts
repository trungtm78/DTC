import { createHash } from 'node:crypto';
import { DomainError } from '@machvon/kernel';
import { appendRevision, describePdf, serializeValue } from './pdf-incremental';
import type { RevisionObject } from './pdf-incremental';
import { dictionaryOf, textOf } from './pdf-objects';
import type { PdfValue } from './pdf-objects';
import { NUMBER_FIELD_NAMES } from './pdf-revisions';

/** The three values numbering writes (BR-DOC-14 c): the number as shown, the symbol and the issue date. */
export interface NumberingValues {
  docNumber: string;
  docSymbol: string;
  docDate: string;
}

export interface NumberingRevision {
  pdf: Buffer;
  /** SHA-256 of the bytes of the earlier revisions, as they were before and after the update (BR-DOC-14 c). */
  prefixSha256: string;
}

const FIELD_FONT_SIZE_PT = 10;
const TEXT_LEFT_PT = 2;
const TEXT_BASELINE_PT = 3;
// Helvetica with WinAnsiEncoding shows every character of a symbol but the crossed D, which a difference entry adds.
const CROSSED_D = 0x80;
const CROSSED_D_SMALL = 0x81;
const CAPITAL_D_WITH_STROKE = 0x110;
const SMALL_D_WITH_STROKE = 0x111;
const LATIN1_LIMIT = 0x100;

function failed(detail: string): DomainError {
  return new DomainError('INCREMENTAL_UPDATE_FAILED', 422, detail);
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// The value of a text field is a UTF-16BE string with a byte-order mark, so the whole symbol is kept.
function valueString(text: string): PdfValue {
  const bytes = Buffer.from(String.fromCharCode(0xfeff) + text, 'utf16le').swap16();
  return { t: 'str', v: [...bytes].map((byte) => String.fromCharCode(byte)).join('') };
}

function displayText(text: string): string {
  let shown = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === CAPITAL_D_WITH_STROKE) shown += String.fromCharCode(CROSSED_D);
    else if (code === SMALL_D_WITH_STROKE) shown += String.fromCharCode(CROSSED_D_SMALL);
    else if (code < LATIN1_LIMIT) shown += character;
    else shown += '?';
  }
  return shown.replace(/[\\()]/g, (mark) => `\\${mark}`);
}

function sizeOf(rect: PdfValue | undefined): { width: number; height: number } {
  if (rect?.t !== 'array' || rect.v.length !== 4 || rect.v.some((item) => item.t !== 'num')) throw failed('field rectangle');
  const [left, bottom, right, top] = rect.v.map((item) => (item.t === 'num' ? item.v : 0)) as [number, number, number, number];
  return { width: Math.abs(right - left), height: Math.abs(top - bottom) };
}

interface Field {
  num: number;
  dictionary: Map<string, PdfValue>;
}

function fieldsOf(pdf: Uint8Array): Map<string, Field> {
  const found = new Map<string, Field>();
  for (const [num, value] of describePdf(pdf).objects) {
    const dictionary = dictionaryOf(value);
    const name = textOf(dictionary?.get('T'));
    if (dictionary !== null && name !== null && NUMBER_FIELD_NAMES.includes(name)) found.set(name, { num, dictionary });
  }
  return found;
}

/**
 * The numbering revision (BR-DOC-14 c, F6): one incremental update that sets the value and the appearance of the three
 * number fields and nothing else. The bytes before it are not touched; their SHA-256 is compared after the write, and a
 * file that lacks a field, already carries a value or does not keep its prefix is refused.
 */
export function applyNumbering(pdf: Uint8Array, values: NumberingValues): NumberingRevision {
  const fields = fieldsOf(pdf);
  const base = describePdf(pdf).size;
  const shownValues: Record<string, string> = { doc_number: values.docNumber, doc_symbol: values.docSymbol, doc_date: values.docDate };
  for (const name of NUMBER_FIELD_NAMES) {
    const field = fields.get(name);
    if (field === undefined) throw failed(name);
    if (field.dictionary.has('V')) throw failed(`${name} already has a value`);
  }
  // The font object comes first, then one appearance stream per field; the field objects replace the old ones.
  const font: RevisionObject = {
    num: base,
    body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${CROSSED_D} /Dcroat /dcroat] >> >>`,
  };
  const updates: RevisionObject[] = [font];
  NUMBER_FIELD_NAMES.forEach((name, position) => {
    const field = fields.get(name) as Field;
    const text = shownValues[name] ?? '';
    const appearanceNum = base + 1 + position;
    const { width, height } = sizeOf(field.dictionary.get('Rect'));
    const content = `BT /F1 ${FIELD_FONT_SIZE_PT} Tf ${TEXT_LEFT_PT} ${TEXT_BASELINE_PT} Td (${displayText(text)}) Tj ET`;
    updates.push({
      num: appearanceNum,
      body: `<< /Type /XObject /Subtype /Form /BBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font.num} 0 R >> >> /Length ${content.length} >>\nstream\n${content}\nendstream`,
    });
    const changed = new Map(field.dictionary);
    changed.set('V', valueString(text));
    changed.set('AP', { t: 'dict', v: new Map<string, PdfValue>([['N', { t: 'ref', obj: appearanceNum, gen: 0 }]]) });
    updates.push({ num: field.num, body: serializeValue({ t: 'dict', v: changed }) });
  });
  const appended = appendRevision(pdf, updates).pdf;
  const prefixSha256 = sha256Of(pdf);
  if (sha256Of(appended.subarray(0, pdf.length)) !== prefixSha256) throw failed('prefix');
  return { pdf: appended, prefixSha256 };
}
