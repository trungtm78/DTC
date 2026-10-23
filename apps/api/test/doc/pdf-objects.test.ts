import { PdfStructureError, appendRevision, describePdf, nextObjectNumber, serializeValue } from '../../src/modules/doc/pdf-incremental.ts';
import {
  PdfSyntaxError,
  canonicalValue,
  canonicalWithout,
  dictionaryOf,
  nameOf,
  parseValue,
  readRevision,
  referencesIn,
  revisionEnds,
  textOf,
} from '../../src/modules/doc/pdf-objects.ts';
import type { PdfValue } from '../../src/modules/doc/pdf-objects.ts';
import { embedSignature, prepareSignature, signedBytesOf } from '../../src/modules/doc/pdf-signing.ts';
import { revisionZero } from './support/pdf-fixture.ts';

function valueOf(text: string): PdfValue {
  return parseValue(text, 0).value;
}

describe('parseValue', () => {
  it('reads names with escapes, numbers, booleans and null', () => {
    expect(valueOf('/A#20B')).toEqual({ t: 'name', v: 'A B' });
    expect(valueOf('-12.5')).toEqual({ t: 'num', v: -12.5 });
    expect(valueOf('.5')).toEqual({ t: 'num', v: 0.5 });
    expect(valueOf('true')).toEqual({ t: 'bool', v: true });
    expect(valueOf('false')).toEqual({ t: 'bool', v: false });
    expect(valueOf('null')).toEqual({ t: 'null' });
  });

  it('reads literal strings with escapes and nested parentheses, and hex strings', () => {
    expect(valueOf('(a\\)b(c)d)')).toEqual({ t: 'str', v: 'a)b(c)d' });
    expect(valueOf('<48 65 6C6c6F>')).toEqual({ t: 'str', v: 'Hello' });
    expect(valueOf('<414>')).toEqual({ t: 'str', v: 'A@' });
  });

  it('reads references, arrays and dictionaries, and skips comments', () => {
    expect(valueOf('12 3 R')).toEqual({ t: 'ref', obj: 12, gen: 3 });
    expect(valueOf('[1 2 R 3 (x) % comment\n /N]')).toEqual({
      t: 'array',
      v: [{ t: 'ref', obj: 1, gen: 2 }, { t: 'num', v: 3 }, { t: 'str', v: 'x' }, { t: 'name', v: 'N' }],
    });
    const dictionary = dictionaryOf(valueOf('<< /A 1 /B << /C [1 2] >> >>'));
    expect(dictionary?.get('A')).toEqual({ t: 'num', v: 1 });
    expect(canonicalValue(dictionary?.get('B'))).toBe('<</C [1 2]>>');
  });

  it.each([
    ['an unterminated string', '(abc'],
    ['an unterminated hex string', '<41'],
    ['hex digits that are not hex', '<4Z>'],
    ['an unterminated array', '[1 2'],
    ['an unterminated dictionary', '<< /A 1'],
    ['a dictionary key that is not a name', '<< 1 2 >>'],
    ['an unexpected character', ')'],
    ['an unknown keyword', 'foo'],
    ['nesting that is too deep', `${'['.repeat(80)}${']'.repeat(80)}`],
  ])('rejects %s', (_name, text) => {
    expect(() => parseValue(text, 0)).toThrow(PdfSyntaxError);
  });
});

describe('canonical forms and helpers', () => {
  it('writes every kind of value in one canonical text, with keys sorted', () => {
    expect(canonicalValue(undefined)).toBe('absent');
    expect(canonicalValue(valueOf('<< /B true /A [null (s) 5 /N 1 0 R] >>'))).toBe('<</A [null "s" 5 /N 1 0 R] /B true>>');
  });

  it('compares dictionaries without the named keys', () => {
    const left = dictionaryOf(valueOf('<< /A 1 /V 2 >>')) as Map<string, PdfValue>;
    const right = dictionaryOf(valueOf('<< /A 1 /V 3 >>')) as Map<string, PdfValue>;
    expect(canonicalWithout(left, ['V'])).toBe(canonicalWithout(right, ['V']));
    expect(canonicalWithout(left, [])).not.toBe(canonicalWithout(right, []));
  });

  it('finds references in nested values and tells names, text and dictionaries apart', () => {
    expect(referencesIn(valueOf('<< /A 1 0 R /B [2 0 R << /C 3 0 R >>] >>'))).toEqual([1, 2, 3]);
    expect(referencesIn(undefined)).toEqual([]);
    expect(referencesIn(valueOf('5'))).toEqual([]);
    expect(nameOf(valueOf('/X'))).toBe('X');
    expect(nameOf(valueOf('5'))).toBeNull();
    expect(textOf(valueOf('(t)'))).toBe('t');
    expect(textOf(undefined)).toBeNull();
    expect(dictionaryOf(valueOf('5'))).toBeNull();
  });

  it('serialises values back to syntax that parses to the same value', () => {
    const value = valueOf('<< /A#20B [1 -2.5 true null (a\\(b) /N 4 0 R] /D << /E 1 >> >>');
    expect(canonicalValue(valueOf(serializeValue(value)))).toBe(canonicalValue(value));
  });
});

describe('readRevision', () => {
  it('reads the objects and trailer of every revision and finds their ends', () => {
    const pdf = revisionZero();
    const text = pdf.toString('latin1');
    expect(revisionEnds(text)).toHaveLength(1);
    const content = readRevision(text, 0, text.length);
    expect(content.foreign).toBe(false);
    expect(content.objects.map((object) => object.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(content.objects[3]?.hasStream).toBe(true);
    expect(content.trailer?.get('Root')).toEqual({ t: 'ref', obj: 1, gen: 0 });
  });

  it('uses the stream length when it is right and looks for endstream when it is not', () => {
    const wrong = '1 0 obj\n<< /Length 999 >>\nstream\nabc\nendstream\nendobj\n';
    expect(readRevision(wrong, 0, wrong.length).objects).toHaveLength(1);
    const missing = '1 0 obj\n<< /Length 3 >>\nstream\nabc\nendobj\n';
    expect(readRevision(missing, 0, missing.length).foreign).toBe(true);
  });

  it('takes the dictionary of a cross-reference stream as the trailer', () => {
    const text = '5 0 obj\n<< /Type /XRef /Root 1 0 R /Size 6 /Length 0 >>\nstream\n\nendstream\nendobj\nstartxref\n9\n%%EOF\n';
    expect(readRevision(text, 0, text.length).trailer?.get('Root')).toEqual({ t: 'ref', obj: 1, gen: 0 });
  });

  it.each([
    ['an object without endobj', '1 0 obj\n<< /A 1 >>\n'],
    ['an xref without a trailer', 'xref\n0 1\n'],
    ['a trailer that is not a dictionary', 'trailer\n[1 2]\n'],
    ['text that is not an object', 'hello world'],
    ['an object that does not parse', '1 0 obj\n<< /A\nendobj\n'],
  ])('marks %s as foreign', (_name, text) => {
    expect(readRevision(text, 0, text.length).foreign).toBe(true);
  });
});

describe('incremental updates and signatures', () => {
  it('appends a revision that leaves the earlier bytes alone and links back to the previous cross-reference section', () => {
    const base = revisionZero();
    const { pdf, offsets } = appendRevision(base, [{ num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' }, { num: 20, body: '<< /X 1 >>' }]);
    expect(pdf.subarray(0, base.length).equals(base)).toBe(true);
    expect(offsets.get(20)).toBeGreaterThan(base.length);
    const state = describePdf(pdf);
    expect(state.size).toBe(21);
    expect(state.trailer.get('Prev')).toEqual({ t: 'num', v: describePdf(base).startXref });
    expect(nextObjectNumber(pdf)).toBe(21);
  });

  it('refuses a file with no cross-reference section to extend', () => {
    expect(() => describePdf(Buffer.from('%PDF-1.7\n'))).toThrow(PdfStructureError);
  });

  it('prepares a signature whose ByteRange covers everything but the Contents value', () => {
    const prepared = prepareSignature(revisionZero(), { fieldName: 'sig_leader', signingTime: new Date('2026-10-23T08:00:00Z') });
    const [first, start, resume, rest] = prepared.byteRange;
    expect(first).toBe(0);
    expect(resume + rest).toBe(prepared.pdf.length);
    expect(prepared.pdf.toString('latin1')[start]).toBe('<');
    expect(signedBytesOf(prepared).length).toBe(start + rest);
  });

  it('refuses a missing field, a field that is signed already and a signature that does not fit', () => {
    const request = { signingTime: new Date('2026-10-23T08:00:00Z') };
    expect(() => prepareSignature(revisionZero(), { ...request, fieldName: 'nothing' })).toThrow('signature field nothing not found');
    const prepared = prepareSignature(revisionZero(), { ...request, fieldName: 'sig_leader', reservedBytes: 8 });
    expect(() => embedSignature(prepared, Buffer.alloc(9))).toThrow('does not fit');
    const filled = embedSignature(prepared, Buffer.alloc(8, 0xab));
    expect(() => prepareSignature(filled, { ...request, fieldName: 'sig_leader' })).toThrow('already signed');
  });

  it('refuses to certify a file that has no catalog', () => {
    const noRoot = Buffer.from(revisionZero().toString('latin1').replace('/Root 1 0 R', '/Root 99 0 R'), 'latin1');
    expect(() => prepareSignature(noRoot, { fieldName: 'sig_leader', signingTime: new Date(), docMdpLevel: 2 })).toThrow('no catalog');
  });
});
