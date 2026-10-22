import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadErrorRegistry } from '../src/error-registry.ts';

const REAL_REGISTRY = resolve(__dirname, '../../../Design/MACHVON_Design/03_Engineering/error_codes.json');

function registryFile(content: unknown): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'machvon-registry-'));
  const path = join(directory, 'error_codes.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

describe('loadErrorRegistry', () => {
  it('merges canonical and registry entries', () => {
    const file = registryFile({
      canonical: {
        SCOPE_DENIED: 'The actor lacks the scope (403).',
        REVIEW_INVALID: 'A review is expired (409); REVIEW_STALE was dropped.',
        NO_STATUS: 'Has no status in its text.',
      },
      registry: { RESOURCE_NOT_FOUND: { status: 404, title: 'Resource not found' } },
    });
    try {
      const registry = loadErrorRegistry(file.path);
      expect(registry.get('SCOPE_DENIED')).toEqual({ status: 403, title: 'The actor lacks the scope (403).' });
      expect(registry.get('REVIEW_INVALID')?.status).toBe(409);
      expect(registry.get('NO_STATUS')?.status).toBe(400);
      expect(registry.get('RESOURCE_NOT_FOUND')).toEqual({ status: 404, title: 'Resource not found' });
      expect(registry.size).toBe(4);
    } finally {
      file.cleanup();
    }
  });

  it('lets a registry entry win over a canonical entry with the same code', () => {
    const file = registryFile({
      canonical: { X_CODE: 'Canonical text (409).' },
      registry: { X_CODE: { status: 422, title: 'Registry title' } },
    });
    try {
      expect(loadErrorRegistry(file.path).get('X_CODE')).toEqual({ status: 422, title: 'Registry title' });
    } finally {
      file.cleanup();
    }
  });

  it('accepts a file with only one of the two sections', () => {
    const file = registryFile({ registry: { A: { status: 500, title: 'A' } } });
    try {
      expect([...loadErrorRegistry(file.path).keys()]).toEqual(['A']);
    } finally {
      file.cleanup();
    }
  });

  it.each([
    ['not JSON', '{nope'],
    ['a non-object root', '[]'],
    ['a registry entry without a numeric status', JSON.stringify({ registry: { A: { title: 'A' } } })],
    ['a registry entry with an out-of-range status', JSON.stringify({ registry: { A: { status: 99, title: 'A' } } })],
    ['a registry entry without a title', JSON.stringify({ registry: { A: { status: 400 } } })],
    ['a canonical entry that is not text', JSON.stringify({ canonical: { A: 5 } })],
    ['a section that is not an object', JSON.stringify({ canonical: 'x' })],
  ])('rejects %s', (_label, content) => {
    const file = registryFile(content);
    try {
      expect(() => loadErrorRegistry(file.path)).toThrow();
    } finally {
      file.cleanup();
    }
  });

  it('loads the real registry with the codes M2a throws', () => {
    const registry = loadErrorRegistry(REAL_REGISTRY);
    expect(registry.get('TENANT_CONTEXT_INVALID')?.status).toBe(400);
    expect(registry.get('INTERNAL_ERROR')?.status).toBe(500);
    expect(registry.get('FIELD_NOT_ALLOWED')?.status).toBe(400);
    expect(registry.get('RESOURCE_NOT_FOUND')?.status).toBe(404);
    expect(registry.get('VALIDATION_FAILED')?.status).toBe(422);
    expect(registry.get('SCOPE_DENIED')?.status).toBe(403);
    expect(registry.get('VERSION_CONFLICT')?.status).toBe(409);
    expect(registry.size).toBeGreaterThan(600);
  });
});
