import { validateValue } from '../src/validation';
import type { Issue, Schema, SchemaTable } from '../src/validation';

const kinds = (issues: Issue[]): string[] => issues.map((issue) => `${issue.kind}:${issue.path}`);
const check = (schema: Schema, value: unknown, table: SchemaTable = {}): Issue[] => validateValue(schema, value, table);

describe('validateValue: objects', () => {
  const schema: Schema = {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'rank'],
    properties: { code: { type: 'string' }, rank: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } },
  };

  it('accepts a valid body', () => {
    expect(check(schema, { code: 'A', rank: 1, tags: ['x'] })).toEqual([]);
  });

  it('reports every unknown field in body order and never its value', () => {
    const issues = check(schema, { code: 'A', rank: 1, tenant_id: 'secret', role: 'secret' });
    expect(kinds(issues)).toEqual(['unknown_field:tenant_id', 'unknown_field:role']);
    expect(JSON.stringify(issues)).not.toContain('secret');
  });

  it('reports a missing required field and a field set to undefined as missing', () => {
    expect(kinds(check(schema, { code: 'A' }))).toEqual(['missing:rank']);
    expect(kinds(check(schema, { code: 'A', rank: undefined }))).toEqual(['missing:rank']);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'text'],
    ['a number', 7],
  ])('reports a body that is %s as a type issue on body', (_label, value) => {
    expect(kinds(check(schema, value))).toEqual(['type:body']);
  });

  it('reports a wrong type of a member as a type issue and names nested members with a dotted path', () => {
    const nested: Schema = { type: 'object', properties: { inner: { type: 'object', properties: { n: { type: 'integer' } } } } };
    expect(kinds(check(nested, { inner: { n: 'x' } }))).toEqual(['type:inner.n']);
    expect(kinds(check(nested, { inner: 'x' }))).toEqual(['type:inner']);
  });

  it('allows extra members when additionalProperties is not false and validates map values against a schema', () => {
    expect(check({ type: 'object' }, { anything: 1 })).toEqual([]);
    const map: Schema = { type: 'object', additionalProperties: { type: 'integer' } };
    expect(check(map, { a: 1, b: 2 })).toEqual([]);
    expect(kinds(check(map, { a: 1, b: 'x' }))).toEqual(['type:b']);
  });
});

describe('validateValue: scalars', () => {
  it('checks string length with minLength and maxLength as constraints', () => {
    const schema: Schema = { type: 'string', minLength: 2, maxLength: 4 };
    expect(check(schema, 'ab')).toEqual([]);
    expect(kinds(check(schema, 'a'))).toEqual(['constraint:body']);
    expect(kinds(check(schema, 'abcde'))).toEqual(['constraint:body']);
    expect(kinds(check(schema, 5))).toEqual(['type:body']);
  });

  it('checks pattern and enum as constraints', () => {
    expect(check({ type: 'string', pattern: '^[A-Z]{2}$' }, 'AB')).toEqual([]);
    expect(kinds(check({ type: 'string', pattern: '^[A-Z]{2}$' }, 'ab'))).toEqual(['constraint:body']);
    expect(check({ type: 'string', enum: ['A', 'B'] }, 'A')).toEqual([]);
    expect(kinds(check({ type: 'string', enum: ['A', 'B'] }, 'C'))).toEqual(['constraint:body']);
  });

  it('checks integers, numbers and booleans', () => {
    expect(check({ type: 'integer', minimum: 1, maximum: 89 }, 89)).toEqual([]);
    expect(kinds(check({ type: 'integer', minimum: 1, maximum: 89 }, 90))).toEqual(['constraint:body']);
    expect(kinds(check({ type: 'integer', minimum: 1, maximum: 89 }, 0))).toEqual(['constraint:body']);
    expect(kinds(check({ type: 'integer' }, 1.5))).toEqual(['type:body']);
    expect(kinds(check({ type: 'integer' }, '1'))).toEqual(['type:body']);
    expect(check({ type: 'number' }, 1.5)).toEqual([]);
    expect(kinds(check({ type: 'number' }, Number.NaN))).toEqual(['type:body']);
    expect(kinds(check({ type: 'number' }, Number.POSITIVE_INFINITY))).toEqual(['type:body']);
    expect(check({ type: 'boolean' }, false)).toEqual([]);
    expect(kinds(check({ type: 'boolean' }, 'yes'))).toEqual(['type:body']);
  });

  it('refuses a date-time whose UTC offset is out of range, so Date can always parse what passes', () => {
    for (const offset of ['+99:99', '+24:00', '-00:60', '+12:75']) {
      expect(kinds(check({ type: 'string', format: 'date-time' }, `2026-10-23T08:00:00${offset}`))).toEqual(['constraint:body']);
    }
    for (const offset of ['+23:59', '-12:00', '+00:00', '+05:30']) {
      const value = `2026-10-23T08:00:00${offset}`;
      expect(check({ type: 'string', format: 'date-time' }, value)).toEqual([]);
      expect(Number.isNaN(new Date(value).getTime())).toBe(false);
    }
  });

  it('accepts null only where the schema allows it', () => {
    expect(kinds(check({ type: 'string' }, null))).toEqual(['type:body']);
    expect(check({ type: ['string', 'null'] }, null)).toEqual([]);
    expect(check({ type: 'string', nullable: true }, null)).toEqual([]);
  });

  it('checks the formats uuid, date, date-time and base64, and ignores formats it does not know', () => {
    expect(check({ type: 'string', format: 'uuid' }, '00000000-0000-4000-8000-00000000000A')).toEqual([]);
    expect(kinds(check({ type: 'string', format: 'uuid' }, 'not-a-uuid'))).toEqual(['constraint:body']);
    expect(check({ type: 'string', format: 'date' }, '2028-02-29')).toEqual([]);
    expect(kinds(check({ type: 'string', format: 'date' }, '2026-02-31'))).toEqual(['constraint:body']);
    expect(kinds(check({ type: 'string', format: 'date' }, '2026-2-1'))).toEqual(['constraint:body']);
    expect(check({ type: 'string', format: 'date-time' }, '2026-10-23T08:30:00Z')).toEqual([]);
    expect(check({ type: 'string', format: 'date-time' }, '2026-10-23T08:30:00.123+07:00')).toEqual([]);
    expect(kinds(check({ type: 'string', format: 'date-time' }, '2026-10-23'))).toEqual(['constraint:body']);
    expect(kinds(check({ type: 'string', format: 'date-time' }, '2026-13-23T08:30:00Z'))).toEqual(['constraint:body']);
    expect(check({ type: 'string', contentEncoding: 'base64' }, 'aGVsbG8=')).toEqual([]);
    expect(kinds(check({ type: 'string', contentEncoding: 'base64' }, '@@@'))).toEqual(['constraint:body']);
    expect(check({ type: 'string', format: 'uri-reference-of-the-future' }, 'anything')).toEqual([]);
  });
});

describe('validateValue: arrays, references and alternatives', () => {
  it('checks items, minItems and maxItems; item problems carry the array path without an index', () => {
    const schema: Schema = { type: 'object', properties: { ids: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', format: 'uuid' } } } };
    expect(check(schema, { ids: ['00000000-0000-4000-8000-00000000000a'] })).toEqual([]);
    expect(kinds(check(schema, { ids: [] }))).toEqual(['constraint:ids']);
    expect(kinds(check(schema, { ids: ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c'] }))).toEqual(['constraint:ids']);
    expect(kinds(check(schema, { ids: ['nope'] }))).toEqual(['constraint:ids']);
    expect(kinds(check(schema, { ids: 'x' }))).toEqual(['type:ids']);
  });

  it('resolves $ref against the schema table and rejects an unknown reference', () => {
    const table: SchemaTable = { Reason: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 10 } } } };
    expect(check({ $ref: '#/components/schemas/Reason' }, { reason: 'long enough text' }, table)).toEqual([]);
    expect(kinds(check({ $ref: '#/components/schemas/Reason' }, { reason: 'short' }, table))).toEqual(['constraint:reason']);
    expect(() => check({ $ref: '#/components/schemas/Missing' }, {}, table)).toThrow('Missing');
  });

  it('accepts a value that matches exactly one alternative of oneOf', () => {
    const schema: Schema = {
      oneOf: [
        { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'integer' } } },
        { type: 'object', additionalProperties: false, required: ['b'], properties: { b: { type: 'integer' } } },
      ],
    };
    expect(check(schema, { a: 1 })).toEqual([]);
    expect(check(schema, { b: 1 })).toEqual([]);
    expect(kinds(check(schema, { c: 1 }))).toEqual(['constraint:body']);
  });

  it('terminates on a self-referencing schema', () => {
    const table: SchemaTable = { Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' }, n: { type: 'integer' } } } };
    expect(check({ $ref: '#/components/schemas/Node' }, { n: 1, child: { n: 2, child: { n: 3 } } }, table)).toEqual([]);
    expect(kinds(check({ $ref: '#/components/schemas/Node' }, { child: { child: { n: 'x' } } }, table))).toEqual(['type:child.child.n']);
  });
});
