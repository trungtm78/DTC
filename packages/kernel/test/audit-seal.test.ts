import { createHash } from 'node:crypto';
import { auditLeafHash, merkleRoot, sealHashOf } from '../src/audit-seal.ts';

const sha = (...parts: Buffer[]): string => createHash('sha256').update(Buffer.concat(parts)).digest('hex');
const node = (left: string, right: string): string => sha(Buffer.from([1]), Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));

describe('auditLeafHash', () => {
  it('prefixes the text with a 0x00 byte before hashing', () => {
    expect(auditLeafHash('row')).toBe(sha(Buffer.from([0]), Buffer.from('row', 'utf8')));
    expect(auditLeafHash('row')).not.toBe(sha(Buffer.from('row', 'utf8')));
  });
});

describe('merkleRoot', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(auditLeafHash) as [string, string, string, string, string];

  it('returns the leaf for one leaf', () => {
    expect(merkleRoot([a])).toBe(a);
  });

  it('matches hand-computed digests for 2 and 3 leaves', () => {
    expect(merkleRoot([a, b])).toBe(node(a, b));
    expect(merkleRoot([a, b, c])).toBe(node(node(a, b), c));
  });

  it('matches hand-computed digests for 4 and 5 leaves', () => {
    expect(merkleRoot([a, b, c, d])).toBe(node(node(a, b), node(c, d)));
    expect(merkleRoot([a, b, c, d, e])).toBe(node(node(node(a, b), node(c, d)), e));
  });

  it('changes when any leaf changes or two leaves swap', () => {
    const root = merkleRoot([a, b, c, d]);
    expect(merkleRoot([a, b, c, e])).not.toBe(root);
    expect(merkleRoot([b, a, c, d])).not.toBe(root);
  });

  it('promotes an odd node instead of duplicating it', () => {
    expect(merkleRoot([a, b, c])).not.toBe(merkleRoot([a, b, c, c]));
  });

  it('rejects empty input and malformed leaves', () => {
    expect(() => merkleRoot([])).toThrow(RangeError);
    expect(() => merkleRoot(['not-a-hash'])).toThrow(TypeError);
  });
});

describe('sealHashOf', () => {
  const root = auditLeafHash('root');

  it('hashes prev || root || to_seq, with an empty prev for the first seal', () => {
    expect(sealHashOf(null, root, 5)).toBe(createHash('sha256').update(`${root}5`).digest('hex'));
    const prev = 'p'.repeat(64);
    expect(sealHashOf(prev, root, 5)).toBe(createHash('sha256').update(`${prev}${root}5`).digest('hex'));
  });
});
