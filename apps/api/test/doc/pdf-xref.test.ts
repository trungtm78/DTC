import { deflateSync } from 'node:zlib';
import { appendRevision, describePdf } from '../../src/modules/doc/pdf-incremental';
import type { RevisionObject } from '../../src/modules/doc/pdf-incremental';
import { readRevision, revisionEnds } from '../../src/modules/doc/pdf-objects';
import type { PdfValue } from '../../src/modules/doc/pdf-objects';
import { analyseLaterRevisions } from '../../src/modules/doc/pdf-revisions';
import { parseXrefStream, parseXrefTable } from '../../src/modules/doc/pdf-xref';
import { revisionZero } from './support/pdf-fixture';

const num = (v: number): PdfValue => ({ t: 'num', v });
const name = (v: string): PdfValue => ({ t: 'name', v });
const array = (...v: PdfValue[]): PdfValue => ({ t: 'array', v });
const dict = (entries: Record<string, PdfValue>): Map<string, PdfValue> => new Map(Object.entries(entries));

/** Rows of the layout W [1 4 2]: type, offset or container, generation or index. */
function rows(...entries: [number, number, number][]): Buffer {
  return Buffer.concat(entries.map(([type, second, third]) => Buffer.from([type, (second >>> 24) & 255, (second >>> 16) & 255, (second >>> 8) & 255, second & 255, (third >>> 8) & 255, third & 255])));
}

const WIDTHS = array(num(1), num(4), num(2));

describe('parseXrefTable', () => {
  it('reads subsections of in-use and free entries', () => {
    expect(parseXrefTable('\n0 2\n0000000000 65535 f \n0000000017 00000 n \n7 1\n0000000099 00001 n \n')).toEqual([
      { num: 0, kind: 'free', offset: 0, gen: 65535 },
      { num: 1, kind: 'inuse', offset: 17, gen: 0 },
      { num: 7, kind: 'inuse', offset: 99, gen: 1 },
    ]);
  });

  it('accepts entries that are one byte short or long, and an empty table', () => {
    expect(parseXrefTable('0 1\r\n0000000017 00000 n\r\n')).toHaveLength(1);
    expect(parseXrefTable('')).toEqual([]);
  });

  it.each(['0 x\n', '0 1\n0000000017 00000 q \n', '0 2\n0000000017 00000 n \n', '3\n'])('refuses %j', (body) => {
    expect(parseXrefTable(body)).toBeNull();
  });
});

describe('parseXrefStream', () => {
  const entries = rows([0, 0, 65535], [1, 15, 0], [2, 7, 3]);

  it('reads the three entry kinds of an uncompressed stream', () => {
    expect(parseXrefStream(dict({ W: WIDTHS, Size: num(3) }), entries)).toEqual([
      { num: 0, kind: 'free', offset: 0, gen: 65535 },
      { num: 1, kind: 'inuse', offset: 15, gen: 0 },
      { num: 2, kind: 'compressed', offset: 7, gen: 3 },
    ]);
  });

  it('follows Index and treats a zero-width type field as in use', () => {
    const body = Buffer.from([0, 0, 0, 0, 0, 0, 40, 1]);
    expect(parseXrefStream(dict({ W: array(num(0), num(3), num(1)), Index: array(num(9), num(2)) }), body)).toEqual([
      { num: 9, kind: 'inuse', offset: 0, gen: 0 },
      { num: 10, kind: 'inuse', offset: 40, gen: 1 },
    ]);
  });

  it('inflates a Flate stream and undoes PNG predictors of every row type', () => {
    const columns = 7;
    const plain = entries;
    const filtered = (type: number): Buffer => {
      const out: number[] = [];
      for (let row = 0; row < 3; row += 1) {
        out.push(type);
        for (let column = 0; column < columns; column += 1) {
          const value = plain[row * columns + column] ?? 0;
          const left = column === 0 ? 0 : (plain[row * columns + column - 1] ?? 0);
          const above = row === 0 ? 0 : (plain[(row - 1) * columns + column] ?? 0);
          const upperLeft = row === 0 || column === 0 ? 0 : (plain[(row - 1) * columns + column - 1] ?? 0);
          const estimate = left + above - upperLeft;
          const [toLeft, toAbove, toUpperLeft] = [Math.abs(estimate - left), Math.abs(estimate - above), Math.abs(estimate - upperLeft)];
          const paeth = toLeft <= toAbove && toLeft <= toUpperLeft ? left : toAbove <= toUpperLeft ? above : upperLeft;
          const predicted = [0, left, above, Math.floor((left + above) / 2), paeth][type] ?? 0;
          out.push((value - predicted) & 255);
        }
      }
      return Buffer.from(out);
    };
    for (const type of [0, 1, 2, 3, 4]) {
      const decoded = parseXrefStream(
        dict({ W: WIDTHS, Size: num(3), Filter: name('FlateDecode'), DecodeParms: { t: 'dict', v: dict({ Predictor: num(12), Columns: num(columns) }) } }),
        deflateSync(filtered(type)),
      );
      expect(decoded?.map((entry) => entry.kind)).toEqual(['free', 'inuse', 'compressed']);
    }
    expect(parseXrefStream(dict({ W: WIDTHS, Size: num(3), Filter: name('FlateDecode') }), deflateSync(entries))).toHaveLength(3);
  });

  it.each<[string, Map<string, PdfValue>, Buffer]>([
    ['widths of the wrong count', dict({ W: array(num(1), num(4)), Size: num(1) }), entries],
    ['a width that is too wide', dict({ W: array(num(1), num(9), num(1)), Size: num(1) }), entries],
    ['all widths zero', dict({ W: array(num(0), num(0), num(0)), Size: num(1) }), entries],
    ['no Size and no Index', dict({ W: WIDTHS }), entries],
    ['an odd Index', dict({ W: WIDTHS, Index: array(num(0)) }), entries],
    ['more rows than data', dict({ W: WIDTHS, Size: num(4) }), entries],
    ['an unknown entry type', dict({ W: WIDTHS, Size: num(1) }), rows([9, 0, 0])],
    ['a filter other than Flate', dict({ W: WIDTHS, Size: num(3), Filter: name('LZWDecode') }), entries],
    ['a stream that does not inflate', dict({ W: WIDTHS, Size: num(3), Filter: name('FlateDecode') }), entries],
    ['a predictor on several colours', dict({ W: WIDTHS, Size: num(3), Filter: name('FlateDecode'), DecodeParms: { t: 'dict', v: dict({ Predictor: num(12), Colors: num(3), Columns: num(7) }) } }), deflateSync(entries)],
    ['a predictor with rows of the wrong length', dict({ W: WIDTHS, Size: num(3), Filter: name('FlateDecode'), DecodeParms: { t: 'dict', v: dict({ Predictor: num(12), Columns: num(5) }) } }), deflateSync(entries)],
  ])('refuses %s', (_label, dictionary, body) => {
    expect(parseXrefStream(dictionary, body)).toBeNull();
  });
});

/** Appends the objects as one revision whose cross-reference is a stream, optionally compressed. */
function appendStreamRevision(pdf: Buffer, updates: RevisionObject[], options: { flate?: boolean; redirect?: Map<number, number> } = {}): Buffer {
  const state = describePdf(pdf);
  const lead = pdf.at(-1) === 0x0a ? '' : '\n';
  let text = lead;
  const offsets = new Map<number, number>();
  for (const update of updates) {
    offsets.set(update.num, pdf.length + Buffer.byteLength(text, 'latin1'));
    text += `${update.num} 0 obj\n${update.body}\nendobj\n`;
  }
  const streamNum = Math.max(state.size, ...updates.map((update) => update.num + 1));
  const streamAt = pdf.length + Buffer.byteLength(text, 'latin1');
  const mapped = new Map([...offsets, ...(options.redirect ?? new Map<number, number>()), [streamNum, streamAt]]);
  const numbers = [...mapped.keys()].sort((left, right) => left - right);
  const data = rows(...numbers.map((number): [number, number, number] => [1, mapped.get(number) ?? 0, 0]));
  const body = options.flate === true ? deflateSync(data) : data;
  const index = numbers.flatMap((number) => [number, 1]).join(' ');
  const root = state.trailer.get('Root');
  const dictionary =
    `<< /Type /XRef /Size ${streamNum + 1} /W [1 4 2] /Index [${index}] /Root ${root?.t === 'ref' ? root.obj : 1} 0 R /Prev ${state.startXref}` +
    `${options.flate === true ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>`;
  text += `${streamNum} 0 obj\n${dictionary}\nstream\n`;
  return Buffer.concat([pdf, Buffer.from(text, 'latin1'), body, Buffer.from(`\nendstream\nendobj\nstartxref\n${streamAt}\n%%EOF\n`, 'latin1')]);
}

describe('revisions whose cross-reference is a stream', () => {
  const base = revisionZero();
  const covers = revisionEnds(base.toString('latin1'))[0] ?? 0;

  it('are read: the entries, the offset of the section and the startxref', () => {
    const appended = appendStreamRevision(base, [{ num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' }], { flate: true });
    const text = appended.toString('latin1');
    const ends = revisionEnds(text);
    const content = readRevision(text, ends[0] ?? 0, ends[1] ?? 0);
    expect(content.xrefInvalid).toBe(false);
    expect(content.xrefAt).not.toBeNull();
    expect(content.startXref).toBe(content.xrefAt);
    expect(content.xref.map((entry) => [entry.num, entry.kind])).toEqual([[4, 'inuse'], [describePdf(base).size, 'inuse']]);
  });

  it('are judged like tables: a content change is refused, a no-op rewrite of a number field is not a redirect', () => {
    const changed = appendStreamRevision(base, [{ num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' }]);
    expect(analyseLaterRevisions(changed.toString('latin1'), covers)).toEqual({ allowed: false, reason: 'object 4 changed' });
    const compressed = appendStreamRevision(base, [{ num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' }], { flate: true });
    expect(analyseLaterRevisions(compressed.toString('latin1'), covers)).toEqual({ allowed: false, reason: 'object 4 changed' });
  });

  it('accept validation data written with a compressed cross-reference stream', () => {
    const size = describePdf(base).size;
    const appended = appendStreamRevision(
      base,
      [
        { num: size, body: `<< /Certs [${size + 1} 0 R] >>` },
        { num: size + 1, body: '<< /Length 3 >>\nstream\nabc\nendstream' },
        { num: 1, body: `<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R /DSS ${size} 0 R >>` },
      ],
      { flate: true },
    );
    expect(analyseLaterRevisions(appended.toString('latin1'), covers)).toEqual({ allowed: true, reason: null });
  });

  it('refuse an entry that maps an object to an older definition', () => {
    const first = appendRevision(base, [{ num: 4, body: '<< /Length 3 >>\nstream\nabc\nendstream' }]).pdf;
    const older = base.toString('latin1').indexOf('\n4 0 obj') + 1;
    const redirected = appendStreamRevision(first, [], { redirect: new Map([[4, older]]) });
    expect(analyseLaterRevisions(redirected.toString('latin1'), revisionEnds(first.toString('latin1')).at(-1) ?? 0)).toEqual({
      allowed: false,
      reason: 'cross-reference entry of object 4 points outside the revision',
    });
  });

  it('refuse a stream they cannot read', () => {
    const appended = appendStreamRevision(base, []);
    const damaged = appended.toString('latin1').replace('/W [1 4 2]', '/W [1 4]');
    expect(analyseLaterRevisions(damaged, covers)).toEqual({ allowed: false, reason: 'cross-reference data that cannot be read' });
  });
});
