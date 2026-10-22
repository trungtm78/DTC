import { createHash } from 'node:crypto';

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);
const HASH_HEX = /^[0-9a-f]{64}$/;

function sha256(...parts: Buffer[]): Buffer {
  return createHash('sha256').update(Buffer.concat(parts)).digest();
}

/** Leaf hash of one canonical audit row: sha256(0x00 || text). */
export function auditLeafHash(canonicalRow: string): string {
  return sha256(LEAF_PREFIX, Buffer.from(canonicalRow, 'utf8')).toString('hex');
}

/**
 * Merkle root over leaf hashes (RFC 6962 shape): node = sha256(0x01 || left || right); an odd last
 * node is promoted unchanged, never duplicated. One leaf is its own root.
 */
export function merkleRoot(leafHashes: readonly string[]): string {
  if (leafHashes.length === 0) throw new RangeError('merkleRoot needs at least one leaf');
  let level: Buffer[] = leafHashes.map((leaf) => {
    if (!HASH_HEX.test(leaf)) throw new TypeError('merkleRoot leaves must be 64 lower-case hex characters');
    return Buffer.from(leaf, 'hex');
  });
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index] as Buffer;
      const right = level[index + 1];
      next.push(right === undefined ? left : sha256(NODE_PREFIX, left, right));
    }
    level = next;
  }
  return (level[0] as Buffer).toString('hex');
}

/** seal_hash = sha256(prev_seal_hash || merkle_root || to_seq), with an empty prev for the first seal. */
export function sealHashOf(prevSealHash: string | null, root: string, toSeq: number): string {
  return createHash('sha256').update(`${prevSealHash ?? ''}${root}${toSeq}`, 'utf8').digest('hex');
}
