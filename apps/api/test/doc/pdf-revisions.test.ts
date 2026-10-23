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
