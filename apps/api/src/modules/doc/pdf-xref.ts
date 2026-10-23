import { inflateSync } from 'node:zlib';
import type { PdfValue } from './pdf-objects';

/**
 * One entry of a cross-reference section: where an object lives, or that it is free. An entry says which definition of an
 * object a reader uses, so revision analysis has to judge entries like it judges objects.
 */
export interface XrefEntry {
  num: number;
  kind: 'free' | 'inuse' | 'compressed';
  /** Byte offset of the object (`inuse`), the number of the object stream (`compressed`), the next free object (`free`). */
  offset: number;
  gen: number;
}

const MAX_FIELD_WIDTH = 6;
const PNG_PREDICTOR_FIRST = 10;

function integerOf(value: PdfValue | undefined): number | null {
  return value?.t === 'num' && Number.isInteger(value.v) && value.v >= 0 ? value.v : null;
}

function singleEntry(value: PdfValue | undefined): PdfValue | undefined {
  return value?.t === 'array' ? (value.v.length === 1 ? value.v[0] : undefined) : value;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const toLeft = Math.abs(estimate - left);
  const toAbove = Math.abs(estimate - above);
  const toUpperLeft = Math.abs(estimate - upperLeft);
  if (toLeft <= toAbove && toLeft <= toUpperLeft) return left;
  return toAbove <= toUpperLeft ? above : upperLeft;
}

/** Undoes the PNG row filters of a stream (predictors 10 to 15); each row starts with its filter type. */
function unfilterPng(data: Buffer, columns: number): Buffer | null {
  const rowLength = columns + 1;
  if (columns < 1 || data.length % rowLength !== 0) return null;
  const rows = data.length / rowLength;
  const output = Buffer.alloc(rows * columns);
  for (let row = 0; row < rows; row += 1) {
    const type = data[row * rowLength] ?? 0;
    for (let column = 0; column < columns; column += 1) {
      const raw = data[row * rowLength + 1 + column] ?? 0;
      const left = column === 0 ? 0 : (output[row * columns + column - 1] ?? 0);
      const above = row === 0 ? 0 : (output[(row - 1) * columns + column] ?? 0);
      const upperLeft = row === 0 || column === 0 ? 0 : (output[(row - 1) * columns + column - 1] ?? 0);
      let predicted: number;
      switch (type) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = above;
          break;
        case 3:
          predicted = Math.floor((left + above) / 2);
          break;
        case 4:
          predicted = paeth(left, above, upperLeft);
          break;
        default:
          return null;
      }
      output[row * columns + column] = (raw + predicted) & 0xff;
    }
  }
  return output;
}

/** The decoded bytes of a cross-reference stream, or null for a filter this reader does not support. */
function decodedStream(dictionary: Map<string, PdfValue>, raw: Buffer): Buffer | null {
  const filter = singleEntry(dictionary.get('Filter'));
  if (filter === undefined) return raw;
  if (filter.t !== 'name' || filter.v !== 'FlateDecode') return null;
  let inflated: Buffer;
  try {
    inflated = inflateSync(raw);
  } catch {
    // A stream that does not inflate cannot be read; the caller refuses the revision.
    return null;
  }
  const parameters = singleEntry(dictionary.get('DecodeParms'));
  if (parameters === undefined || parameters.t === 'null') return inflated;
  if (parameters.t !== 'dict') return null;
  const predictor = integerOf(parameters.v.get('Predictor')) ?? 1;
  if (predictor === 1) return inflated;
  const columns = integerOf(parameters.v.get('Columns')) ?? 1;
  const colors = integerOf(parameters.v.get('Colors')) ?? 1;
  const bits = integerOf(parameters.v.get('BitsPerComponent')) ?? 8;
  if (predictor < PNG_PREDICTOR_FIRST || colors !== 1 || bits !== 8) return null;
  return unfilterPng(inflated, columns);
}

function fieldOf(row: Buffer, from: number, width: number, fallback: number): number {
  if (width === 0) return fallback;
  let value = 0;
  for (let at = 0; at < width; at += 1) value = value * 256 + (row[from + at] ?? 0);
  return value;
}

/**
 * Reads the entries of a cross-reference stream (ISO 32000-1 7.5.8): `W` gives the field widths, `Index` the object
 * numbers the rows describe. Null when the stream cannot be read, which makes the revision that holds it refused.
 */
export function parseXrefStream(dictionary: Map<string, PdfValue>, raw: Buffer): XrefEntry[] | null {
  const widths = dictionary.get('W');
  if (widths?.t !== 'array' || widths.v.length !== 3) return null;
  const [typeWidth, offsetWidth, genWidth] = widths.v.map((item) => integerOf(item));
  if (typeWidth === null || offsetWidth === null || genWidth === null) return null;
  if (typeWidth === undefined || offsetWidth === undefined || genWidth === undefined) return null;
  if (Math.max(typeWidth, offsetWidth, genWidth) > MAX_FIELD_WIDTH) return null;
  const rowWidth = typeWidth + offsetWidth + genWidth;
  if (rowWidth === 0) return null;
  const size = integerOf(dictionary.get('Size'));
  const indexValue = dictionary.get('Index');
  const ranges: number[] = [];
  if (indexValue === undefined) {
    if (size === null) return null;
    ranges.push(0, size);
  } else if (indexValue.t === 'array' && indexValue.v.length % 2 === 0) {
    for (const item of indexValue.v) {
      const number = integerOf(item);
      if (number === null) return null;
      ranges.push(number);
    }
  } else {
    return null;
  }
  const data = decodedStream(dictionary, raw);
  if (data === null) return null;
  const entries: XrefEntry[] = [];
  let row = 0;
  for (let range = 0; range < ranges.length; range += 2) {
    const first = ranges[range] ?? 0;
    const count = ranges[range + 1] ?? 0;
    if ((row + count) * rowWidth > data.length) return null;
    for (let index = 0; index < count; index += 1, row += 1) {
      const start = row * rowWidth;
      const type = fieldOf(data, start, typeWidth, 1);
      const second = fieldOf(data, start + typeWidth, offsetWidth, 0);
      const third = fieldOf(data, start + typeWidth + offsetWidth, genWidth, 0);
      if (type === 0) entries.push({ num: first + index, kind: 'free', offset: second, gen: third });
      else if (type === 1) entries.push({ num: first + index, kind: 'inuse', offset: second, gen: third });
      else if (type === 2) entries.push({ num: first + index, kind: 'compressed', offset: second, gen: third });
      else return null;
    }
  }
  return entries;
}

/**
 * The entries of a classic cross-reference table: the text between `xref` and `trailer`, as subsections of
 * `first count` followed by `count` rows of `offset generation n|f`. Null when the table is malformed.
 */
export function parseXrefTable(body: string): XrefEntry[] | null {
  const tokens = body.split(/\s+/).filter((token) => token !== '');
  const entries: XrefEntry[] = [];
  let at = 0;
  while (at < tokens.length) {
    const first = /^\d+$/.test(tokens[at] ?? '') ? Number(tokens[at]) : null;
    const count = /^\d+$/.test(tokens[at + 1] ?? '') ? Number(tokens[at + 1]) : null;
    if (first === null || count === null) return null;
    at += 2;
    for (let index = 0; index < count; index += 1, at += 3) {
      const offset = tokens[at] ?? '';
      const gen = tokens[at + 1] ?? '';
      const kind = tokens[at + 2];
      if (!/^\d+$/.test(offset) || !/^\d+$/.test(gen) || (kind !== 'n' && kind !== 'f')) return null;
      entries.push({ num: first + index, kind: kind === 'n' ? 'inuse' : 'free', offset: Number(offset), gen: Number(gen) });
    }
  }
  return entries;
}
