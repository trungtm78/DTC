import { createHash } from 'node:crypto';

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface WithToJson {
  toJSON(): unknown;
}

function hasToJson(value: object): value is WithToJson {
  return typeof (value as { toJSON?: unknown }).toJSON === 'function';
}

function write(value: unknown, ancestors: object[]): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: numbers must be finite');
      return JSON.stringify(value);
    case 'object':
      return writeObject(value, ancestors);
    default:
      throw new TypeError(`canonicalJson: ${typeof value} is not representable`);
  }
}

function writeObject(value: object, ancestors: object[]): string {
  if (ancestors.includes(value)) throw new TypeError('canonicalJson: cyclic structure');
  if (hasToJson(value)) return write(value.toJSON(), ancestors);
  const path = [...ancestors, value];
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => (item === undefined ? 'null' : write(item, path))).join(',')}]`;
  }
  const members = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${write(member, path)}`);
  return `{${members.join(',')}}`;
}

/**
 * Deterministic JSON: keys sorted at every depth, no whitespace, `undefined` members dropped,
 * array order kept. Throws TypeError for NaN, Infinity, functions, symbols, bigint and cycles.
 */
export function canonicalJson(value: unknown): string {
  return write(value, []);
}
