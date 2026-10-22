import { applyTestProfile } from '../src/test-profile';

describe('applyTestProfile', () => {
  it('removes the vector extension line and replaces vector(1024) with real[]', () => {
    expect(applyTestProfile('CREATE EXTENSION IF NOT EXISTS vector;\nx vector(1024)')).toBe('\nx real[]');
  });

  it('replaces every vector(1024) occurrence', () => {
    expect(applyTestProfile('a vector(1024),\nb vector(1024)')).toBe('a real[],\nb real[]');
  });

  it('leaves SQL without pgvector usage unchanged', () => {
    const sql = 'CREATE EXTENSION IF NOT EXISTS pgcrypto;\nCREATE TABLE t (id uuid);';
    expect(applyTestProfile(sql)).toBe(sql);
  });
});
