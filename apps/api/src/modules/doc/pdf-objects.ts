import { parseXrefStream, parseXrefTable } from './pdf-xref';
import type { XrefEntry } from './pdf-xref';

// A reader for the part of the PDF syntax that revision analysis needs: objects, dictionaries and the trailer. It works
// on the file read as latin1 text, so one character is one byte and every offset is a byte offset.

export type PdfValue =
  | { t: 'null' }
  | { t: 'bool'; v: boolean }
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; v: string }
  | { t: 'ref'; obj: number; gen: number }
  | { t: 'array'; v: PdfValue[] }
  | { t: 'dict'; v: Map<string, PdfValue> };

export interface PdfObject {
  num: number;
  gen: number;
  value: PdfValue;
  hasStream: boolean;
  /** Byte offset of the object header (`n g obj`): the position a cross-reference entry names. */
  offset: number;
  /** The span of the stream data, when the object has a stream. */
  stream: { start: number; end: number } | null;
}

export interface RevisionContent {
  objects: PdfObject[];
  /** The trailer dictionary, or the dictionary of a cross-reference stream, when the revision has one. */
  trailer: Map<string, PdfValue> | null;
  /** True when something in the slice is not an object, a cross-reference section, a trailer or a comment. */
  foreign: boolean;
  /** The entries of the cross-reference section of the slice (a table or a stream). */
  xref: XrefEntry[];
  /** Offset of the last cross-reference section (the `xref` keyword or the cross-reference stream object). */
  xrefAt: number | null;
  /** The number the last `startxref` of the slice gives. */
  startXref: number | null;
  /** True when a cross-reference section could not be read. */
  xrefInvalid: boolean;
}

const WHITESPACE = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const REGULAR_END = (character: string | undefined): boolean =>
  character === undefined || WHITESPACE.has(character) || DELIMITERS.has(character);
const MAX_DEPTH = 64;
const LINE_ENDS_ONLY = /^[\r\n]*$/;

export class PdfSyntaxError extends Error {}

function skipWhitespace(text: string, from: number): number {
  let position = from;
  while (position < text.length && WHITESPACE.has(text.charAt(position))) position += 1;
  return position;
}

function skipSpaceAndComments(text: string, from: number): number {
  let position = skipWhitespace(text, from);
  while (text.charAt(position) === '%') {
    while (position < text.length && text.charAt(position) !== '\n' && text.charAt(position) !== '\r') position += 1;
    position = skipWhitespace(text, position);
  }
  return position;
}

function readToken(text: string, from: number): { token: string; end: number } {
  let end = from;
  while (!REGULAR_END(text[end])) end += 1;
  return { token: text.slice(from, end), end };
}

function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** The characters (one per byte) a hex string stands for; an odd last digit counts as followed by 0. */
function bytesOfHex(hex: string): string {
  const digits = hex.replace(/\s+/g, '');
  if (!/^[0-9A-Fa-f]*$/.test(digits)) throw new PdfSyntaxError('hex string with other characters');
  const even = digits.length % 2 === 0 ? digits : `${digits}0`;
  return (even.match(/../g) ?? []).map((pair) => String.fromCharCode(parseInt(pair, 16))).join('');
}

function readLiteralString(text: string, from: number): { value: PdfValue; end: number } {
  let depth = 0;
  let position = from;
  let result = '';
  for (; position < text.length; position += 1) {
    const character = text.charAt(position);
    if (character === '\\') {
      position += 1;
      result += text.charAt(position);
    } else if (character === '(') {
      if (depth > 0) result += character;
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) return { value: { t: 'str', v: result }, end: position + 1 };
      result += character;
    } else {
      result += character;
    }
  }
  throw new PdfSyntaxError('unterminated string');
}

function readValue(text: string, from: number, depth: number): { value: PdfValue; end: number } {
  if (depth > MAX_DEPTH) throw new PdfSyntaxError('nesting too deep');
  const start = skipSpaceAndComments(text, from);
  const character = text.charAt(start);
  if (character === '<' && text.charAt(start + 1) === '<') return readDictionary(text, start + 2, depth);
  if (character === '<') {
    const close = text.indexOf('>', start);
    if (close < 0) throw new PdfSyntaxError('unterminated hex string');
    return { value: { t: 'str', v: bytesOfHex(text.slice(start + 1, close)) }, end: close + 1 };
  }
  if (character === '[') return readArray(text, start + 1, depth);
  if (character === '(') return readLiteralString(text, start);
  if (character === '/') {
    const { token, end } = readToken(text, start + 1);
    return { value: { t: 'name', v: decodeName(token) }, end };
  }
  const { token, end } = readToken(text, start);
  if (token === '') throw new PdfSyntaxError(`unexpected character at ${start}`);
  if (token === 'true' || token === 'false') return { value: { t: 'bool', v: token === 'true' }, end };
  if (token === 'null') return { value: { t: 'null' }, end };
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(token)) {
    const reference = /^(\d+)\s+(\d+)\s+R(?![^\s/<>[\]()%])/.exec(text.slice(start, start + 40));
    if (reference !== null && /^\d+$/.test(token)) {
      return {
        value: { t: 'ref', obj: Number(reference[1]), gen: Number(reference[2]) },
        end: start + reference[0].length,
      };
    }
    return { value: { t: 'num', v: Number(token) }, end };
  }
  throw new PdfSyntaxError(`unexpected token ${token.slice(0, 12)}`);
}

function readArray(text: string, from: number, depth: number): { value: PdfValue; end: number } {
  const items: PdfValue[] = [];
  let position = from;
  for (;;) {
    position = skipSpaceAndComments(text, position);
    if (position >= text.length) throw new PdfSyntaxError('unterminated array');
    if (text.charAt(position) === ']') return { value: { t: 'array', v: items }, end: position + 1 };
    const item = readValue(text, position, depth + 1);
    items.push(item.value);
    position = item.end;
  }
}

function readDictionary(text: string, from: number, depth: number): { value: PdfValue; end: number } {
  const entries = new Map<string, PdfValue>();
  let position = from;
  for (;;) {
    position = skipSpaceAndComments(text, position);
    if (position >= text.length) throw new PdfSyntaxError('unterminated dictionary');
    if (text.startsWith('>>', position)) return { value: { t: 'dict', v: entries }, end: position + 2 };
    if (text.charAt(position) !== '/') throw new PdfSyntaxError('dictionary key is not a name');
    const key = readToken(text, position + 1);
    const member = readValue(text, key.end, depth + 1);
    entries.set(decodeName(key.token), member.value);
    position = member.end;
  }
}

/** Parses the value that starts at `from` (after any whitespace). */
export function parseValue(text: string, from: number): { value: PdfValue; end: number } {
  return readValue(text, from, 0);
}

/** Where the data of a stream ends and where the `endstream` keyword ends. */
function streamExtent(text: string, dataStart: number, dictionary: PdfValue): { dataEnd: number; end: number } {
  if (dictionary.t === 'dict') {
    const length = dictionary.v.get('Length');
    if (length?.t === 'num' && Number.isInteger(length.v) && length.v >= 0) {
      const after = skipWhitespace(text, dataStart + length.v);
      if (text.startsWith('endstream', after)) return { dataEnd: dataStart + length.v, end: after + 'endstream'.length };
    }
  }
  const found = text.indexOf('endstream', dataStart);
  if (found < 0) throw new PdfSyntaxError('stream without endstream');
  let dataEnd = found;
  if (text.charAt(dataEnd - 1) === '\n') dataEnd -= 1;
  if (text.charAt(dataEnd - 1) === '\r') dataEnd -= 1;
  return { dataEnd: Math.max(dataStart, dataEnd), end: found + 'endstream'.length };
}

function readObject(text: string, from: number): { object: PdfObject; end: number } | null {
  const header = /^(\d+)\s+(\d+)\s+obj(?![^\s/<>[\]()%])/.exec(text.slice(from, from + 40));
  if (header === null) return null;
  const parsed = readValue(text, from + header[0].length, 0);
  let end = skipSpaceAndComments(text, parsed.end);
  let hasStream = false;
  let stream: { start: number; end: number } | null = null;
  if (text.startsWith('stream', end)) {
    hasStream = true;
    let dataStart = end + 'stream'.length;
    if (text.charAt(dataStart) === '\r') dataStart += 1;
    if (text.charAt(dataStart) === '\n') dataStart += 1;
    const extent = streamExtent(text, dataStart, parsed.value);
    stream = { start: dataStart, end: extent.dataEnd };
    end = skipWhitespace(text, extent.end);
  }
  if (!text.startsWith('endobj', end)) throw new PdfSyntaxError('object without endobj');
  return {
    object: { num: Number(header[1]), gen: Number(header[2]), value: parsed.value, hasStream, offset: from, stream },
    end: end + 'endobj'.length,
  };
}

/** Reads the slice [from, to) of the file as one revision: its objects, its trailer and whether anything is foreign. */
export function readRevision(text: string, from: number, to: number): RevisionContent {
  const slice = text.slice(0, to);
  const content: RevisionContent = { objects: [], trailer: null, foreign: false, xref: [], xrefAt: null, startXref: null, xrefInvalid: false };
  let position = from;
  try {
    for (;;) {
      position = skipWhitespace(slice, position);
      if (position >= to) return content;
      if (slice.charAt(position) === '%') {
        position = skipSpaceAndComments(slice, position);
      } else if (slice.startsWith('xref', position)) {
        const trailer = slice.indexOf('trailer', position);
        if (trailer < 0) throw new PdfSyntaxError('xref without trailer');
        const table = parseXrefTable(slice.slice(position + 'xref'.length, trailer));
        if (table === null) content.xrefInvalid = true;
        else content.xref.push(...table);
        content.xrefAt = position;
        position = trailer;
      } else if (slice.startsWith('trailer', position)) {
        const parsed = readValue(slice, position + 'trailer'.length, 0);
        if (parsed.value.t !== 'dict') throw new PdfSyntaxError('trailer is not a dictionary');
        content.trailer = parsed.value.v;
        position = parsed.end;
      } else if (slice.startsWith('startxref', position)) {
        const given = readToken(slice, skipWhitespace(slice, position + 'startxref'.length));
        content.startXref = /^\d+$/.test(given.token) ? Number(given.token) : null;
        position = given.end;
      } else {
        const read = readObject(slice, position);
        if (read === null) throw new PdfSyntaxError('foreign content');
        content.objects.push(read.object);
        if (read.object.value.t === 'dict' && read.object.value.v.get('Type')?.t === 'name') {
          const type = read.object.value.v.get('Type');
          if (type?.t === 'name' && type.v === 'XRef') {
            content.trailer = read.object.value.v;
            content.xrefAt = read.object.offset;
            const data = read.object.stream === null ? null : Buffer.from(slice.slice(read.object.stream.start, read.object.stream.end), 'latin1');
            const entries = data === null ? null : parseXrefStream(read.object.value.v, data);
            if (entries === null) content.xrefInvalid = true;
            else content.xref.push(...entries);
          }
        }
        position = read.end;
      }
    }
  } catch (error) {
    if (!(error instanceof PdfSyntaxError)) throw error;
    content.foreign = true;
    return content;
  }
}

/** Offsets just after each `%%EOF` that closes a cross-reference section: the possible ends of a revision. */
export function revisionEnds(text: string): number[] {
  const ends: number[] = [];
  const marker = /startxref\s+\d+\s*%%EOF(\r\n|\r|\n)?/g;
  for (let match = marker.exec(text); match !== null; match = marker.exec(text)) {
    ends.push(match.index + match[0].length);
  }
  return ends;
}

/**
 * The end of the revision that a coverage ending at `offset` belongs to: a signature may stop right after `%%EOF` or after
 * the line end that follows it, and both are the end of that revision. Undefined when the offset is inside a revision.
 */
export function revisionBoundary(text: string, ends: readonly number[], offset: number): number | undefined {
  return ends.find((end) => end >= offset && LINE_ENDS_ONLY.test(text.slice(offset, end)));
}

export function dictionaryOf(value: PdfValue | undefined): Map<string, PdfValue> | null {
  return value?.t === 'dict' ? value.v : null;
}

export function nameOf(value: PdfValue | undefined): string | null {
  return value?.t === 'name' ? value.v : null;
}

export function textOf(value: PdfValue | undefined): string | null {
  return value?.t === 'str' ? value.v : null;
}

/** A canonical text for a value, so two values can be compared for equality. */
export function canonicalValue(value: PdfValue | undefined): string {
  if (value === undefined) return 'absent';
  switch (value.t) {
    case 'null':
      return 'null';
    case 'bool':
    case 'num':
      return String(value.v);
    case 'name':
      return `/${value.v}`;
    case 'str':
      return JSON.stringify(value.v);
    case 'ref':
      return `${value.obj} ${value.gen} R`;
    case 'array':
      return `[${value.v.map((item) => canonicalValue(item)).join(' ')}]`;
    case 'dict':
      return `<<${[...value.v.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, member]) => `/${key} ${canonicalValue(member)}`)
        .join(' ')}>>`;
  }
}

/** The dictionary without the named keys, canonicalised: what is left once the allowed keys are set aside. */
export function canonicalWithout(dictionary: Map<string, PdfValue>, keys: readonly string[]): string {
  const rest = new Map(dictionary);
  for (const key of keys) rest.delete(key);
  return canonicalValue({ t: 'dict', v: rest });
}

/** Every indirect reference inside a value. */
export function referencesIn(value: PdfValue | undefined): number[] {
  if (value === undefined) return [];
  if (value.t === 'ref') return [value.obj];
  if (value.t === 'array') return value.v.flatMap((item) => referencesIn(item));
  if (value.t === 'dict') return [...value.v.values()].flatMap((member) => referencesIn(member));
  return [];
}
