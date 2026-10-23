import { appendRevision, describePdf } from '../../src/modules/doc/pdf-incremental';
import { revisionEnds } from '../../src/modules/doc/pdf-objects';
import { analyseLaterRevisions } from '../../src/modules/doc/pdf-revisions';
import type { RevisionObject } from '../../src/modules/doc/pdf-incremental';
import { revisionZero, withNumbering } from './support/pdf-fixture';
import type { FixtureOptions } from './support/pdf-fixture';

const WIDGET = '/Type /Annot /Subtype /Widget /P 3 0 R /F 4';
const NUMBERING = { doc_number: '7', doc_symbol: 'CV', doc_date: '23/10/2026' };

function verdictAfter(base: Buffer, updates: RevisionObject[]): { allowed: boolean; reason: string | null } {
  const text = base.toString('latin1');
  const coversEnd = revisionEnds(text)[0] ?? 0;
  return analyseLaterRevisions(appendRevision(base, updates).pdf.toString('latin1'), coversEnd);
}

function bodyOf(pdf: Buffer, num: number): string {
  const text = pdf.toString('latin1');
  const header = new RegExp(`(^|\\n)${num} 0 obj\\n`, 'g');
  let start = -1;
  for (let match = header.exec(text); match !== null; match = header.exec(text)) start = match.index + match[0].length;
  return text.slice(start, text.indexOf('\nendobj', start));
}

describe('revisions that are allowed after a signature', () => {
  it('accepts the numbering revision: value and display of the three number fields', () => {
    const base = revisionZero();
    const numbered = withNumbering(base, NUMBERING);
    expect(analyseLaterRevisions(numbered.toString('latin1'), revisionEnds(base.toString('latin1'))[0] ?? 0)).toEqual({ allowed: true, reason: null });
  });

  it('accepts a new signature field that is added to the form and to the page', () => {
    const base = revisionZero();
    const size = describePdf(base).size;
    const verdict = verdictAfter(base, [
      { num: size, body: `<< ${WIDGET} /FT /Sig /T (sig_extra) /Rect [10 10 20 20] >>` },
      { num: 5, body: bodyOf(base, 5).replace('] /SigFlags', ` ${size} 0 R] /SigFlags`) },
      { num: 3, body: bodyOf(base, 3).replace('/Annots [', `/Annots [${size} 0 R `).replace(`${size} 0 R 6 0 R`, `6 0 R`).replace(/\] \/Resources/, ` ${size} 0 R] /Resources`) },
    ]);
    expect(verdict.reason).toBeNull();
  });

  it('accepts a signature value in an empty field together with its signature dictionary', () => {
    const base = revisionZero();
    const size = describePdf(base).size;
    const verdict = verdictAfter(base, [
      { num: size, body: '<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 1 2 3] /Contents <00> >>' },
      { num: 10, body: bodyOf(base, 10).replace(' >>', ` /V ${size} 0 R >>`) },
    ]);
    expect(verdict.allowed).toBe(true);
  });

  it('accepts an annotation list kept in an object of its own when it only grows by a signature field', () => {
    const base = revisionZero({ indirectAnnotations: true });
    const size = describePdf(base).size;
    const verdict = verdictAfter(base, [
      { num: size, body: `<< ${WIDGET} /FT /Sig /T (sig_extra) /Rect [10 10 20 20] >>` },
      { num: 13, body: bodyOf(base, 13).replace(']', ` ${size} 0 R]`) },
    ]);
    expect(verdict.reason).toBeNull();
  });

  it('accepts validation data (DSS) reached from the catalog and nothing else', () => {
    const base = revisionZero();
    const size = describePdf(base).size;
    const verdict = verdictAfter(base, [
      { num: size, body: `<< /Certs [${size + 1} 0 R] >>` },
      { num: size + 1, body: '<< /Length 3 >>\nstream\nabc\nendstream' },
      { num: 1, body: bodyOf(base, 1).replace(' >>', ` /DSS ${size} 0 R >>`) },
    ]);
    expect(verdict.reason).toBeNull();
  });
});

describe('revisions that are refused after a signature', () => {
  const base = revisionZero();
  const size = describePdf(base).size;

  it.each([
    ['a number field gets other flags', [{ num: 6, body: bodyOf(base, 6).replace('/FT /Tx', '/FT /Tx /Ff 1') }], 'field doc_number changed beyond value and display'],
    ['page content is replaced', [{ num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' }], 'object 4 changed'],
    ['an unrelated new object appears', [{ num: size, body: '<< /Type /Annot /Subtype /Text >>' }], `new object ${size}`],
    ['the catalog gains an open action', [{ num: 1, body: bodyOf(base, 1).replace(' >>', ' /OpenAction 3 0 R >>') }], 'catalog changed beyond DSS'],
    ['the form dictionary changes beyond its signature fields', [{ num: 5, body: bodyOf(base, 5).replace('/SigFlags 3', '/SigFlags 3 /NeedAppearances true') }], 'form dictionary changed beyond signature fields'],
    ['the form dictionary gains a field that is not a signature field', [{ num: 5, body: bodyOf(base, 5).replace('] /SigFlags', ' 11 0 R] /SigFlags') }], 'form dictionary changed beyond signature fields'],
    ['the page gains an annotation that is not a signature widget', [{ num: 3, body: bodyOf(base, 3).replace('] /Resources', ' 11 0 R] /Resources') }], 'page changed beyond signature widgets'],
    ['the page gets other content', [{ num: 3, body: bodyOf(base, 3).replace('/Contents 4 0 R', '/Contents 11 0 R') }], 'page changed beyond signature widgets'],
    ['an object stream appears', [{ num: size, body: '<< /Type /ObjStm /N 0 /First 0 /Length 0 >>\nstream\n\nendstream' }], `object stream ${size}`],
    ['the font object is replaced by another type', [{ num: 11, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>' }], 'object 11 changed'],
    ['the form dictionary is replaced by an array', [{ num: 5, body: '[1 2 3]' }], 'form dictionary replaced'],
  ] as [string, RevisionObject[], string][])('refuses when %s', (_name, updates, reason) => {
    expect(verdictAfter(base, updates)).toEqual({ allowed: false, reason });
  });

  it('refuses a signature field that already holds a signature and is changed again', () => {
    const signedOnce = appendRevision(base, [
      { num: size, body: '<< /Type /Sig /ByteRange [0 1 2 3] /Contents <00> >>' },
      { num: 10, body: bodyOf(base, 10).replace(' >>', ` /V ${size} 0 R >>`) },
    ]).pdf;
    const again = appendRevision(signedOnce, [
      { num: size + 1, body: '<< /Type /Sig /ByteRange [0 1 2 3] /Contents <00> >>' },
      { num: 10, body: bodyOf(signedOnce, 10).replace(` /V ${size} 0 R`, ` /V ${size + 1} 0 R`) },
    ]).pdf;
    const coversEnd = revisionEnds(signedOnce.toString('latin1'))[1] ?? 0;
    expect(analyseLaterRevisions(again.toString('latin1'), coversEnd)).toEqual({ allowed: false, reason: 'signature field changed beyond its value' });
  });

  it('refuses an annotation list that grows by something other than a signature field', () => {
    const indirect = revisionZero({ indirectAnnotations: true });
    const verdict = verdictAfter(indirect, [{ num: 13, body: bodyOf(indirect, 13).replace(']', ' 11 0 R]') }]);
    expect(verdict).toEqual({ allowed: false, reason: 'array changed beyond signature widgets' });
  });

  it('refuses a revision that points the document at another root', () => {
    const appended = appendRevision(base, [{ num: size, body: '<< /Type /Catalog /Pages 2 0 R >>' }]).pdf.toString('latin1');
    const swapped = appended.replace(/\/Root 1 0 R(?![\s\S]*\/Root 1 0 R)/, `/Root ${size} 0 R`);
    expect(analyseLaterRevisions(swapped, revisionEnds(base.toString('latin1'))[0] ?? 0)).toEqual({ allowed: false, reason: 'document root replaced' });
  });

  it('refuses content between the objects that is not an object, and bytes after the last revision', () => {
    const text = withNumbering(base, NUMBERING).toString('latin1');
    const coversEnd = revisionEnds(base.toString('latin1'))[0] ?? 0;
    const foreign = text.slice(0, coversEnd) + '\ngarbage\n' + text.slice(coversEnd);
    expect(analyseLaterRevisions(foreign, coversEnd)).toEqual({ allowed: false, reason: 'content that is not an object' });
    expect(analyseLaterRevisions(`${text}tail`, coversEnd)).toEqual({ allowed: false, reason: 'bytes after the last revision' });
  });

  it('refuses a coverage that does not end where a revision ends', () => {
    const text = appendRevision(base, []).pdf.toString('latin1');
    expect(analyseLaterRevisions(text, 12)).toEqual({ allowed: false, reason: 'coverage does not end at a revision end' });
  });

  it('accepts a signature that is already the last revision', () => {
    const text = base.toString('latin1');
    expect(analyseLaterRevisions(text, revisionEnds(text)[0] ?? 0)).toEqual({ allowed: true, reason: null });
  });
});

describe('options of the fixture', () => {
  it.each<FixtureOptions>([{}, { timestampField: true }, { indirectAnnotations: true }])('builds a readable file for %j', (options) => {
    expect(describePdf(revisionZero(options)).size).toBeGreaterThan(11);
  });
});

/** The text of the revision that follows `pdf` and holds the given cross-reference section and nothing else. */
function rawRevision(pdf: Buffer, xref: string, trailer?: (current: { size: number; prev: number }) => string): string {
  const text = pdf.toString('latin1');
  const lead = text.endsWith('\n') ? '' : '\n';
  const at = text.length + lead.length;
  const { size, startXref } = describePdf(pdf);
  const dictionary = trailer?.({ size, prev: startXref }) ?? `/Size ${size} /Prev ${startXref} /Root 1 0 R`;
  return `${text}${lead}${xref}trailer\n<< ${dictionary} >>\nstartxref\n${at}\n%%EOF\n`;
}

function offsetOfObject(pdf: Buffer, num: number): number {
  const header = new RegExp(`(^|\n)${num} 0 obj\n`, 'g');
  const text = pdf.toString('latin1');
  const match = header.exec(text);
  if (match === null) throw new Error(`object ${num} not found`);
  return match.index + match[0].length - `${num} 0 obj\n`.length;
}

const entry = (offset: number, kind: 'n' | 'f' = 'n'): string => `${String(offset).padStart(10, '0')} 00000 ${kind} \n`;

describe('cross-reference data is judged like the objects (revisions that redirect, free or skip)', () => {
  const base = revisionZero();
  const replaced = appendRevision(base, [{ num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' }]).pdf;
  const coversReplaced = revisionEnds(replaced.toString('latin1')).at(-1) ?? 0;

  it('refuses an xref-only revision that maps an object back to its older definition', () => {
    const redirect = rawRevision(replaced, `xref\n4 1\n${entry(offsetOfObject(base, 4))}`);
    expect(analyseLaterRevisions(redirect, coversReplaced)).toEqual({ allowed: false, reason: 'cross-reference entry of object 4 points outside the revision' });
  });

  it('refuses an xref entry that points into the middle of the file where no object starts', () => {
    const redirect = rawRevision(replaced, `xref\n4 1\n${entry(offsetOfObject(base, 4) + 3)}`);
    expect(analyseLaterRevisions(redirect, coversReplaced).allowed).toBe(false);
  });

  it('refuses a revision that frees an object', () => {
    const freed = rawRevision(replaced, `xref\n4 1\n${entry(0, 'f')}`);
    expect(analyseLaterRevisions(freed, coversReplaced)).toEqual({ allowed: false, reason: 'object 4 is freed' });
  });

  it('refuses a revision whose startxref points at an older cross-reference section', () => {
    const text = replaced.toString('latin1');
    const older = describePdf(base).startXref;
    const skipped = `${text}\nstartxref\n${older}\n%%EOF\n`;
    expect(analyseLaterRevisions(skipped, coversReplaced)).toEqual({ allowed: false, reason: 'startxref does not point at the cross-reference section of its revision' });
  });

  it('refuses a revision whose Prev skips the signed revision', () => {
    const skipping = rawRevision(replaced, 'xref\n0 0\n', ({ size }) => `/Size ${size} /Prev ${describePdf(base).startXref} /Root 1 0 R`);
    expect(analyseLaterRevisions(skipping, coversReplaced)).toEqual({ allowed: false, reason: 'cross-reference chain broken' });
  });

  it('refuses a revision without Prev, which would hide every earlier object', () => {
    const text = rawRevision(replaced, 'xref\n0 0\n', ({ size }) => `/Size ${size} /Root 1 0 R`);
    expect(analyseLaterRevisions(text, coversReplaced)).toEqual({ allowed: false, reason: 'cross-reference chain broken' });
  });

  it('refuses a trailer that shrinks Size', () => {
    const shrunk = rawRevision(replaced, 'xref\n0 0\n', ({ prev }) => `/Size 5 /Prev ${prev} /Root 1 0 R`);
    expect(analyseLaterRevisions(shrunk, coversReplaced)).toEqual({ allowed: false, reason: 'trailer Size shrinks' });
  });

  it('refuses a hybrid-reference trailer', () => {
    const hybrid = rawRevision(replaced, 'xref\n0 0\n', ({ size, prev }) => `/Size ${size} /Prev ${prev} /Root 1 0 R /XRefStm 9`);
    expect(analyseLaterRevisions(hybrid, coversReplaced)).toEqual({ allowed: false, reason: 'hybrid cross-reference' });
  });

  it('refuses a trailer that turns on encryption', () => {
    const encrypted = rawRevision(replaced, 'xref\n0 0\n', ({ size, prev }) => `/Size ${size} /Prev ${prev} /Root 1 0 R /Encrypt 3 0 R`);
    expect(analyseLaterRevisions(encrypted, coversReplaced)).toEqual({ allowed: false, reason: 'trailer Encrypt' });
  });

  it('refuses an object that the cross-reference of its revision does not map', () => {
    const text = base.toString('latin1');
    const object = '\n4 0 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj\n';
    const xrefAt = text.length + object.length;
    const { size, startXref } = describePdf(base);
    const decoy = `${text}${object}xref\n0 0\ntrailer\n<< /Size ${size} /Prev ${startXref} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    expect(analyseLaterRevisions(decoy, revisionEnds(text)[0] ?? 0)).toEqual({ allowed: false, reason: 'object 4 is not in the cross-reference' });
  });

  it('still accepts the numbering revision, whose cross-reference maps exactly its own objects', () => {
    const numbered = withNumbering(base, NUMBERING);
    expect(analyseLaterRevisions(numbered.toString('latin1'), revisionEnds(base.toString('latin1'))[0] ?? 0)).toEqual({ allowed: true, reason: null });
  });
});

describe('validation data (DSS) may add evidence and never replace content', () => {
  const base = revisionZero();
  const size = describePdf(base).size;

  it('refuses a catalog update that points /DSS at the page content while that content is replaced', () => {
    const verdict = verdictAfter(base, [
      { num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' },
      { num: 1, body: bodyOf(base, 1).replace(' >>', ' /DSS 4 0 R >>') },
    ]);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('validation data reaches existing object 4');
  });

  it('refuses a DSS that lists an existing content object among its certificates', () => {
    const verdict = verdictAfter(base, [
      { num: size, body: '<< /Certs [4 0 R] >>' },
      { num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' },
      { num: 1, body: bodyOf(base, 1).replace(' >>', ` /DSS ${size} 0 R >>`) },
    ]);
    expect(verdict).toEqual({ allowed: false, reason: 'validation data reaches existing object 4' });
  });

  it('refuses a DSS written inline in the catalog that reaches existing content', () => {
    const verdict = verdictAfter(base, [
      { num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' },
      { num: 1, body: bodyOf(base, 1).replace(' >>', ' /DSS << /Certs [4 0 R] >> >>') },
    ]);
    expect(verdict.allowed).toBe(false);
  });

  it('accepts a second validation update that extends the DSS dictionary it already owns', () => {
    const first = appendRevision(base, [
      { num: size, body: `<< /Certs [${size + 1} 0 R] >>` },
      { num: size + 1, body: '<< /Length 3 >>\nstream\nabc\nendstream' },
      { num: 1, body: bodyOf(base, 1).replace(' >>', ` /DSS ${size} 0 R >>`) },
    ]).pdf;
    const coversEnd = revisionEnds(first.toString('latin1')).at(-1) ?? 0;
    const second = appendRevision(first, [
      { num: size + 2, body: '<< /Length 3 >>\nstream\ndef\nendstream' },
      { num: size, body: `<< /Certs [${size + 1} 0 R ${size + 2} 0 R] >>` },
    ]).pdf;
    expect(analyseLaterRevisions(second.toString('latin1'), coversEnd)).toEqual({ allowed: true, reason: null });
  });

  it('refuses a later update that rewrites existing content and lists it in the DSS it already owns', () => {
    const first = appendRevision(base, [
      { num: size, body: `<< /Certs [${size + 1} 0 R] >>` },
      { num: size + 1, body: '<< /Length 3 >>\nstream\nabc\nendstream' },
      { num: 1, body: bodyOf(base, 1).replace(' >>', ` /DSS ${size} 0 R >>`) },
    ]).pdf;
    const coversEnd = revisionEnds(first.toString('latin1')).at(-1) ?? 0;
    const second = appendRevision(first, [
      { num: size, body: `<< /Certs [${size + 1} 0 R 4 0 R] >>` },
      { num: 4, body: '<< /Length 3 >>\nstream\nxyz\nendstream' },
    ]).pdf;
    expect(analyseLaterRevisions(second.toString('latin1'), coversEnd)).toEqual({ allowed: false, reason: 'validation data reaches existing object 4' });
  });
});

describe('DocMDP permissions bound the revisions after a certifying signature', () => {
  const base = revisionZero({ timestampField: true });
  const covers = revisionEnds(base.toString('latin1'))[0] ?? 0;

  it('refuses form values at level 1 and accepts them at level 2 and 3', () => {
    const numbered = withNumbering(base, NUMBERING).toString('latin1');
    expect(analyseLaterRevisions(numbered, covers, 1)).toEqual({ allowed: false, reason: 'DocMDP level 1 forbids filling in fields' });
    expect(analyseLaterRevisions(numbered, covers, 2)).toEqual({ allowed: true, reason: null });
    expect(analyseLaterRevisions(numbered, covers, 3)).toEqual({ allowed: true, reason: null });
  });

  it('refuses a further signature at level 1', () => {
    const size = describePdf(base).size;
    const signed = appendRevision(base, [
      { num: size, body: '<< /Type /Sig /ByteRange [0 1 2 3] /Contents <00> >>' },
      { num: 10, body: bodyOf(base, 10).replace(' >>', ` /V ${size} 0 R >>`) },
    ]).pdf.toString('latin1');
    expect(analyseLaterRevisions(signed, covers, 1)).toEqual({ allowed: false, reason: 'DocMDP level 1 forbids signing' });
    expect(analyseLaterRevisions(signed, covers, 2)).toEqual({ allowed: true, reason: null });
  });

  it('still accepts validation data and a document timestamp at level 1', () => {
    const size = describePdf(base).size;
    const withDss = appendRevision(base, [
      { num: size, body: `<< /Certs [${size + 1} 0 R] >>` },
      { num: size + 1, body: '<< /Length 3 >>\nstream\nabc\nendstream' },
      { num: 1, body: bodyOf(base, 1).replace(' >>', ` /DSS ${size} 0 R >>`) },
    ]).pdf;
    expect(analyseLaterRevisions(withDss.toString('latin1'), covers, 1)).toEqual({ allowed: true, reason: null });
    const next = describePdf(withDss).size;
    const stamped = appendRevision(withDss, [
      { num: next, body: '<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 /ByteRange [0 1 2 3] /Contents <00> >>' },
      { num: 12, body: bodyOf(base, 12).replace(' >>', ` /V ${next} 0 R >>`) },
    ]).pdf;
    expect(analyseLaterRevisions(stamped.toString('latin1'), covers, 1)).toEqual({ allowed: true, reason: null });
  });

  it('refuses at level 1 a signature dictionary of another kind put into the timestamp field', () => {
    const size = describePdf(base).size;
    const sneaky = appendRevision(base, [
      { num: size, body: '<< /Type /Sig /ByteRange [0 1 2 3] /Contents <00> >>' },
      { num: 12, body: bodyOf(base, 12).replace(' >>', ` /V ${size} 0 R >>`) },
    ]).pdf;
    expect(analyseLaterRevisions(sneaky.toString('latin1'), covers, 1).allowed).toBe(false);
  });

  it('accepts at level 1 a document timestamp put into a new field and refuses a signature put into one', () => {
    const size = describePdf(base).size;
    const widget = `<< /Type /Annot /Subtype /Widget /P 3 0 R /F 4 /FT /Sig /T (extra) /Rect [10 10 20 20] /V ${size} 0 R >>`;
    const revision = (dictionary: string): Buffer =>
      appendRevision(base, [
        { num: size, body: dictionary },
        { num: size + 1, body: widget },
        { num: 5, body: bodyOf(base, 5).replace('] /SigFlags', ` ${size + 1} 0 R] /SigFlags`) },
      ]).pdf;
    const timestamp = '<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 /ByteRange [0 1 2 3] /Contents <00> >>';
    const signature = '<< /Type /Sig /ByteRange [0 1 2 3] /Contents <00> >>';
    expect(analyseLaterRevisions(revision(timestamp).toString('latin1'), covers, 1)).toEqual({ allowed: true, reason: null });
    expect(analyseLaterRevisions(revision(signature).toString('latin1'), covers, 1).allowed).toBe(false);
  });

  it('refuses at level 1 a new signature field', () => {
    const size = describePdf(base).size;
    const added = appendRevision(base, [
      { num: size, body: `<< ${'/Type /Annot /Subtype /Widget /P 3 0 R /F 4'} /FT /Sig /T (sig_extra) /Rect [10 10 20 20] >>` },
      { num: 5, body: bodyOf(base, 5).replace('] /SigFlags', ` ${size} 0 R] /SigFlags`) },
    ]).pdf;
    expect(analyseLaterRevisions(added.toString('latin1'), covers, 1).allowed).toBe(false);
    expect(analyseLaterRevisions(added.toString('latin1'), covers, 2).allowed).toBe(true);
  });
});

/**
 * Revision 0 whose page tree (objects 2 and 3) lives in an object stream, with the page content stream (object 4) also listed in
 * the DSS the signer wrote. A reader displays object 4 as the page content; the verifier cannot see the page tree.
 */
function compressedPageTreeBase(): Buffer {
  const pages = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const page = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>';
  const header = `2 0 3 ${pages.length + 1}\n`;
  const objectStream = `${header}${pages}\n${page}`;
  const bodies = new Map<number, string>([
    [1, '<< /Type /Catalog /Pages 2 0 R /DSS 6 0 R >>'],
    [4, '<< /Length 36 >>\nstream\nBT /F1 12 Tf 72 780 Td (Hello) Tj ET\nendstream'],
    [6, '<< /Certs [4 0 R] >>'],
    [7, `<< /Type /ObjStm /N 2 /First ${header.length} /Length ${objectStream.length} >>\nstream\n${objectStream}\nendstream`],
  ]);
  let text = '%PDF-1.7\n%âãÏÓ\n';
  const offsets = new Map<number, number>();
  for (const [num, body] of bodies) {
    offsets.set(num, Buffer.byteLength(text, 'latin1'));
    text += `${num} 0 obj\n${body}\nendobj\n`;
  }
  const streamAt = Buffer.byteLength(text, 'latin1');
  const row = (type: number, second: number, third: number): number[] => [type, (second >>> 24) & 255, (second >>> 16) & 255, (second >>> 8) & 255, second & 255, (third >>> 8) & 255, third & 255];
  const data = Buffer.from([
    ...row(0, 0, 65535),
    ...row(1, offsets.get(1) ?? 0, 0),
    ...row(2, 7, 0),
    ...row(2, 7, 1),
    ...row(1, offsets.get(4) ?? 0, 0),
    ...row(0, 0, 0),
    ...row(1, offsets.get(6) ?? 0, 0),
    ...row(1, offsets.get(7) ?? 0, 0),
    ...row(1, streamAt, 0),
  ]);
  text += `8 0 obj\n<< /Type /XRef /Size 9 /W [1 4 2] /Root 1 0 R /Length ${data.length} >>\nstream\n`;
  return Buffer.concat([Buffer.from(text, 'latin1'), data, Buffer.from(`\nendstream\nendobj\nstartxref\n${streamAt}\n%%EOF\n`, 'latin1')]);
}

describe('validation data does not own content the verifier cannot see', () => {
  const base = compressedPageTreeBase();

  it('refuses a replacement of a page content stream listed in the DSS while the page tree sits in an object stream', () => {
    const verdict = verdictAfter(base, [{ num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' }]);
    expect(verdict).toEqual({ allowed: false, reason: 'validation data reaches existing object 4' });
  });
});
