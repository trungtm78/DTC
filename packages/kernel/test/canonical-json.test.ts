import { canonicalJson, sha256Hex } from '../src/canonical-json.ts';

describe('canonicalJson', () => {
  it('sorts keys at every depth without whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });

  it('drops undefined members but keeps array order and nulls', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson([2, 1, undefined])).toBe('[2,1,null]');
  });

  it('writes equal numbers identically', () => {
    expect(canonicalJson({ n: 1e3 })).toBe(canonicalJson({ n: 1000 }));
    expect(canonicalJson({ n: 1000.5 })).not.toBe(canonicalJson({ n: 1000 }));
  });

  it('round trips Vietnamese text and escapes control characters', () => {
    const text = 'Đà Nẵng "quoted" \n';
    expect(JSON.parse(canonicalJson({ city: text }))).toEqual({ city: text });
  });

  it('writes booleans and sorts keys by code unit', () => {
    expect(canonicalJson({ b: true, a: false, B: null })).toBe('{"B":null,"a":false,"b":true}');
  });

  it('serialises dates through toJSON', () => {
    expect(canonicalJson({ at: new Date('2026-01-02T03:04:05.000Z') })).toBe('{"at":"2026-01-02T03:04:05.000Z"}');
  });

  it('does not treat a shared (non-cyclic) reference as a cycle', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it.each<[string, unknown]>([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['bigint', 10n],
    ['nested NaN', { a: [Number.NaN] }],
    ['undefined at the root', undefined],
  ])('throws TypeError for %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('throws TypeError for a cycle', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(TypeError);
  });
});

describe('sha256Hex', () => {
  it('hashes UTF-8 text to 64 lower-case hex characters', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('Đ')).toMatch(/^[0-9a-f]{64}$/);
  });
});
