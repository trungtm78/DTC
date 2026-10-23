import { DomainError } from '@machvon/kernel';
import { buildContent, fillPlaceholders } from '../../src/modules/doc/template-render';
import type { ContentSource } from '../../src/modules/doc/template-render';

const text = { nationalTitle: 'NT', motto: 'M', numberPrefix: 'So:', placeDateFormat: '{place}, ngay {day} thang {month} nam {year}', recipientsLabel: 'R', recipientBullet: '- ', pageNumberFormat: '{page}' };

function failure(work: () => unknown): { code: string; detail: string | undefined; fields: unknown } {
  try {
    work();
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code, detail: error.detail, fields: error.extensions?.fields };
    throw error;
  }
  throw new Error('expected a failure');
}

describe('fillPlaceholders', () => {
  const blocks = [
    { kind: 'heading' as const, text: 'Decision {{title}}' },
    { kind: 'paragraph' as const, text: 'Amount {{ budget.amount }} VND, approved: {{approved}}, note: [{{note}}]' },
  ];

  it('replaces named and dotted placeholders with the payload, numbers as plain decimal text', () => {
    const filled = fillPlaceholders(blocks, { title: 'Q1', budget: { amount: 1234567.5 }, approved: true, note: null }, { required: ['title'] });
    expect(filled).toEqual([
      { kind: 'heading', text: 'Decision Q1' },
      { kind: 'paragraph', text: 'Amount 1234567.5 VND, approved: true, note: []' },
    ]);
  });

  it('writes a very large or very small number without an exponent', () => {
    const filled = fillPlaceholders([{ kind: 'paragraph', text: '{{big}} {{small}}' }], { big: 1e21, small: 1e-7 }, {});
    expect(filled[0]?.text).toBe('1000000000000000000000 0.0000001');
  });

  it('normalises text to NFC', () => {
    const decomposed = 'Việt';
    expect(fillPlaceholders([{ kind: 'paragraph', text: '{{name}}' }], { name: decomposed }, {})[0]?.text).toBe(decomposed.normalize('NFC'));
  });

  it('leaves an optional placeholder empty and names every missing required one', () => {
    expect(fillPlaceholders(blocks, { title: 'Q1' }, { required: ['title'] })[1]?.text).toBe('Amount  VND, approved: , note: []');
    const missing = failure(() => fillPlaceholders(blocks, {}, { required: ['title', 'budget.amount'] }));
    expect(missing).toEqual({ code: 'PAYLOAD_SCHEMA_INVALID', detail: 'title', fields: ['title', 'budget.amount'] });
  });

  it('treats an empty string as missing for a required field', () => {
    expect(failure(() => fillPlaceholders(blocks, { title: '' }, { required: ['title'] })).code).toBe('PAYLOAD_SCHEMA_INVALID');
  });

  it('refuses a placeholder that points at an object or a list', () => {
    expect(failure(() => fillPlaceholders(blocks, { title: { nested: 1 } }, {}))).toMatchObject({ code: 'PAYLOAD_SCHEMA_INVALID', detail: 'title' });
    expect(failure(() => fillPlaceholders(blocks, { title: ['a'] }, {}))).toMatchObject({ code: 'PAYLOAD_SCHEMA_INVALID', detail: 'title' });
  });

  it('does not walk into the prototype of the payload', () => {
    const filled = fillPlaceholders([{ kind: 'paragraph', text: '[{{constructor}}][{{__proto__.x}}]' }], {}, {});
    expect(filled[0]?.text).toBe('[][]');
  });

  it('does not expand placeholders inside values (no second pass)', () => {
    const filled = fillPlaceholders([{ kind: 'paragraph', text: '{{a}}' }], { a: '{{b}}', b: 'secret' }, {});
    expect(filled[0]?.text).toBe('{{b}}');
  });
});

describe('buildContent', () => {
  const source: ContentSource = {
    template: { title: 'Decision', docTypeCode: 'QD', bodyBlocks: [{ kind: 'paragraph', text: '{{body}}' }], placeholderSchema: { required: ['body'] } },
    payload: { body: 'Text', agency: 'Project board', parent_agency: 'Provincial committee', place: 'Cao Bang', summary: 'On approval', signer_title: 'Director', signer_name: 'An', recipients: ['As above', 'File'], number: '05/QD-UBND', doc_type_name: 'Decision of the board' },
    asOfDate: '2026-06-05',
  };

  it('reads the fixed parts of a document from the payload', () => {
    const content = buildContent(source, text);
    expect(content).toEqual({
      parentAgency: 'Provincial committee',
      agency: 'Project board',
      docTypeName: 'Decision of the board',
      numberText: 'So: 05/QD-UBND',
      placeDate: 'Cao Bang, ngay 05 thang 6 nam 2026',
      summary: 'On approval',
      blocks: [{ kind: 'paragraph', text: 'Text' }],
      signerTitle: 'Director',
      signerName: 'An',
      recipients: ['As above', 'File'],
    });
  });

  it('leaves the number open before numbering and falls back to the template title', () => {
    const content = buildContent({ ...source, payload: { body: 'Text', agency: 'Board', place: 'Cao Bang' } }, text);
    expect(content).toMatchObject({ numberText: 'So:', docTypeName: 'Decision', parentAgency: null, summary: null, signerTitle: null, signerName: null, recipients: [] });
  });

  it('refuses a missing agency or place and a list of recipients that is not text', () => {
    expect(failure(() => buildContent({ ...source, payload: { body: 'Text', place: 'Cao Bang' } }, text))).toMatchObject({ code: 'PAYLOAD_SCHEMA_INVALID', detail: 'agency' });
    expect(failure(() => buildContent({ ...source, payload: { body: 'Text', agency: 'Board' } }, text))).toMatchObject({ code: 'PAYLOAD_SCHEMA_INVALID', detail: 'place' });
    expect(failure(() => buildContent({ ...source, payload: { ...source.payload as object, recipients: [1] } }, text)).detail).toBe('recipients');
    expect(failure(() => buildContent({ ...source, payload: { ...source.payload as object, recipients: 'x' } }, text)).detail).toBe('recipients');
  });

  it('refuses a payload that is not an object', () => {
    expect(failure(() => buildContent({ ...source, payload: 'x' }, text)).code).toBe('PAYLOAD_SCHEMA_INVALID');
    expect(failure(() => buildContent({ ...source, payload: [] }, text)).code).toBe('PAYLOAD_SCHEMA_INVALID');
  });
});
