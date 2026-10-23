import { ND30_A4_STANDARD } from '../src/pdf-layout.ts';
import { documentIdOf, normalisePayload, payloadSha256, renderInputHash } from '../src/pdf-render.ts';

describe('normalisePayload (BR-DOC-11)', () => {
  it('writes numbers as decimal strings and keeps strings in Unicode NFC', () => {
    const decomposed = 'Đã Nẵng'.normalize('NFD');
    expect(normalisePayload({ amount: 1500, ratio: 0.25, name: decomposed, nested: [{ n: -3 }] })).toEqual({
      amount: '1500',
      ratio: '0.25',
      name: decomposed.normalize('NFC'),
      nested: [{ n: '-3' }],
    });
  });

  it('keeps a member named __proto__ as an ordinary key of the payload', () => {
    const payload = JSON.parse('{"__proto__":{"amount":100},"kept":1}') as unknown;
    const normalised = normalisePayload(payload) as Record<string, unknown>;
    expect(Object.keys(normalised).sort()).toEqual(['__proto__', 'kept']);
    expect(Object.getPrototypeOf(normalised)).toBe(Object.prototype);
    expect(payloadSha256(payload)).not.toBe(payloadSha256({ kept: 1 }));
    expect(payloadSha256(JSON.parse('{"__proto__":{"amount":100}}'))).not.toBe(payloadSha256({}));
    expect(payloadSha256(JSON.parse('{"__proto__":{"amount":100}}'))).not.toBe(payloadSha256(JSON.parse('{"__proto__":{"amount":200}}')));
  });

  it('refuses keys that become equal after Unicode normalisation instead of letting the order decide', () => {
    const composed = '\u00e9';
    const decomposed = 'e\u0301';
    expect(() => normalisePayload({ [composed]: 1, [decomposed]: 2 })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(() => normalisePayload({ [decomposed]: 2, [composed]: 1 })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(() => payloadSha256({ nested: { [composed]: 1, [decomposed]: 2 } })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(payloadSha256({ [decomposed]: 1 })).toBe(payloadSha256({ [composed]: 1 }));
  });

  it('keeps booleans and null and drops undefined members', () => {
    expect(normalisePayload({ a: true, b: null, c: undefined })).toEqual({ a: true, b: null });
  });

  it('never writes an exponent', () => {
    expect(normalisePayload({ small: 1e-7, large: 1e21 })).toEqual({ small: '0.0000001', large: '1000000000000000000000' });
  });

  it('refuses values that are not data', () => {
    expect(() => normalisePayload({ n: Number.NaN })).toThrow(TypeError);
    expect(() => normalisePayload({ n: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => normalisePayload({ f: () => 1 })).toThrow(TypeError);
  });
});

describe('payloadSha256', () => {
  it('does not depend on key order and changes with any value', () => {
    expect(payloadSha256({ a: 1, b: { c: 2, d: 3 } })).toBe(payloadSha256({ b: { d: 3, c: 2 }, a: 1 }));
    expect(payloadSha256({ a: 1 })).not.toBe(payloadSha256({ a: 2 }));
    expect(payloadSha256({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats 1 and "1" as the same decimal string (numbers are normalised)', () => {
    expect(payloadSha256({ a: 1 })).toBe(payloadSha256({ a: '1' }));
  });
});

describe('renderInputHash and documentIdOf (F14)', () => {
  const base = {
    templateContentSha256: 'a'.repeat(64),
    templateRevision: 2,
    layout: ND30_A4_STANDARD,
    payload: { to: 'Sở Tài chính' },
    asOfDate: '2026-10-23',
    rendererVersion: 'renderer-1',
    watermarkText: null,
  };

  it('is stable for equal input and independent of payload key order', () => {
    expect(renderInputHash(base)).toBe(renderInputHash({ ...base, payload: { to: 'Sở Tài chính' } }));
    expect(renderInputHash({ ...base, payload: { b: 1, a: 2 } })).toBe(renderInputHash({ ...base, payload: { a: 2, b: 1 } }));
  });

  it.each([
    ['template content', { templateContentSha256: 'b'.repeat(64) }],
    ['template revision', { templateRevision: 3 }],
    ['layout', { layout: { ...ND30_A4_STANDARD, revision: 2 } }],
    ['payload', { payload: { to: 'Sở Kế hoạch' } }],
    ['as-of date', { asOfDate: '2026-10-24' }],
    ['renderer version', { rendererVersion: 'renderer-2' }],
    ['watermark', { watermarkText: 'DRAFT' }],
  ])('changes with the %s', (_label, change) => {
    expect(renderInputHash({ ...base, ...change })).not.toBe(renderInputHash(base));
  });

  it('derives a 16 byte document id from the hash', () => {
    const hash = renderInputHash(base);
    expect(documentIdOf(hash)).toBe(hash.slice(0, 32));
    expect(documentIdOf(hash)).toHaveLength(32);
  });
});
