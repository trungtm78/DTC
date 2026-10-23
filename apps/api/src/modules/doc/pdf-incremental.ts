import { readRevision, revisionEnds } from './pdf-objects.ts';
import type { PdfValue } from './pdf-objects.ts';

/** An object an incremental update adds or replaces: `body` is everything between `obj` and `endobj`. */
export interface RevisionObject {
  num: number;
  body: string;
}

export interface PdfState {
  /** The latest definition of every object, from all revisions. */
  objects: Map<number, PdfValue>;
  trailer: Map<string, PdfValue>;
  /** Offset the last `startxref` points to: the next revision links to it with /Prev. */
  startXref: number;
  size: number;
}

export class PdfStructureError extends Error {}

const XREF_ENTRY_GENERATION = '00000';

/** Serialises a parsed value back to PDF syntax; strings come out as hex strings, which lose nothing. */
export function serializeValue(value: PdfValue): string {
  switch (value.t) {
    case 'null':
      return 'null';
    case 'bool':
      return value.v ? 'true' : 'false';
    case 'num':
      return String(value.v);
    case 'name':
      return `/${[...value.v].map((character) => (/[A-Za-z0-9._+-]/.test(character) ? character : `#${character.charCodeAt(0).toString(16).padStart(2, '0')}`)).join('')}`;
    case 'str':
      return `<${[...value.v].map((character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('')}>`;
    case 'ref':
      return `${value.obj} ${value.gen} R`;
    case 'array':
      return `[${value.v.map((item) => serializeValue(item)).join(' ')}]`;
    case 'dict':
      return `<<${[...value.v.entries()].map(([key, member]) => `${serializeValue({ t: 'name', v: key })} ${serializeValue(member)}`).join(' ')}>>`;
  }
}

/** Reads the objects and the trailer of a file as its revisions leave them. */
export function describePdf(pdf: Uint8Array): PdfState {
  const text = Buffer.from(pdf).toString('latin1');
  const objects = new Map<number, PdfValue>();
  let trailer: Map<string, PdfValue> | null = null;
  let start = 0;
  for (const end of revisionEnds(text)) {
    const content = readRevision(text, start, end);
    for (const object of content.objects) objects.set(object.num, object.value);
    trailer = content.trailer ?? trailer;
    start = end;
  }
  const startXref = [...text.matchAll(/startxref\s+(\d+)/g)].at(-1)?.[1];
  const size = trailer?.get('Size');
  if (trailer === null || startXref === undefined || size?.t !== 'num') {
    throw new PdfStructureError('the file has no cross-reference section to extend');
  }
  return { objects, trailer, startXref: Number(startXref), size: size.v };
}

function subsections(numbers: readonly number[]): number[][] {
  const groups: number[][] = [];
  for (const number of [...numbers].sort((left, right) => left - right)) {
    const group = groups.at(-1);
    if (group !== undefined && group.at(-1) === number - 1) group.push(number);
    else groups.push([number]);
  }
  return groups;
}

/**
 * Appends one incremental update that replaces or adds `updates`, with a classic cross-reference section and a trailer
 * that links back to the previous one. Nothing before the update changes: the first `pdf.length` bytes stay as they were.
 */
export function appendRevision(pdf: Uint8Array, updates: readonly RevisionObject[]): { pdf: Buffer; offsets: Map<number, number> } {
  const state = describePdf(pdf);
  const lead = pdf.at(-1) === 0x0a ? '' : '\n';
  let text = lead;
  const offsets = new Map<number, number>();
  for (const update of updates) {
    offsets.set(update.num, pdf.length + Buffer.byteLength(text, 'latin1'));
    text += `${update.num} 0 obj\n${update.body}\nendobj\n`;
  }
  const xrefOffset = pdf.length + Buffer.byteLength(text, 'latin1');
  let table = 'xref\n';
  for (const group of subsections([...offsets.keys()])) {
    table += `${group[0]} ${group.length}\n`;
    for (const number of group) {
      table += `${String(offsets.get(number)).padStart(10, '0')} ${XREF_ENTRY_GENERATION} n \n`;
    }
  }
  const size = Math.max(state.size, ...[...offsets.keys()].map((number) => number + 1));
  const carried = ['Root', 'Info', 'ID']
    .flatMap((key) => {
      const member = state.trailer.get(key);
      return member === undefined ? [] : [`/${key} ${serializeValue(member)}`];
    })
    .join(' ');
  table += `trailer\n<< /Size ${size} /Prev ${state.startXref} ${carried} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return { pdf: Buffer.concat([Buffer.from(pdf), Buffer.from(text + table, 'latin1')]), offsets };
}

/** The next free object number. */
export function nextObjectNumber(pdf: Uint8Array): number {
  return describePdf(pdf).size;
}
