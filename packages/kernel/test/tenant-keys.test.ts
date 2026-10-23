import { InvalidKeyError, TenantCache, tenantKey } from '../src/tenant-keys.ts';
import type { KeyValueStore } from '../src/tenant-keys.ts';
import type { TenantContext } from '../src/tenant-context.ts';

const TENANT_A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const TENANT_B = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.data.set(key, value);
    this.ttls.set(key, ttlSeconds);
    return Promise.resolve();
  }
}

function context(tenantId: string): TenantContext {
  return { tenantId, membershipId: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a', scopeVersion: 1 };
}

describe('tenantKey', () => {
  it('builds t:{tenantId}:{parts joined by colon}', () => {
    expect(tenantKey(TENANT_A, 'session', 'abc')).toBe(`t:${TENANT_A}:session:abc`);
  });

  it('lowercases an upper-case tenant id', () => {
    expect(tenantKey(TENANT_A.toUpperCase(), 'x')).toBe(`t:${TENANT_A}:x`);
  });

  it.each(['', 'a', '; drop table x', 'x'.repeat(40), '3f2b8c1e4d5a4b6c8d7e9f0a1b2c3d4e', `${TENANT_A}*`])(
    'rejects the invalid tenant id %j',
    (tenantId) => {
      expect(() => tenantKey(tenantId, 'x')).toThrow(InvalidKeyError);
    },
  );

  it('rejects a non-string tenant id', () => {
    expect(() => tenantKey(undefined as unknown as string, 'x')).toThrow(InvalidKeyError);
  });

  it('rejects zero parts', () => {
    expect(() => tenantKey(TENANT_A)).toThrow(InvalidKeyError);
  });

  it.each(['', 'x*', '*', 'a:b', ':', 'a b', ' ', 'a\tb', 'a\nb', 'a\u0000b', 'a\u007fb'])(
    'rejects the invalid part %j',
    (part) => {
      expect(() => tenantKey(TENANT_A, 'ok', part)).toThrow(InvalidKeyError);
    },
  );

  it('does not echo the offending value in the error message', () => {
    expect(() => tenantKey(TENANT_A, 'secret*value')).toThrow(/^(?!.*secret)/);
    expect(() => tenantKey('secret-tenant', 'x')).toThrow(/^(?!.*secret)/);
  });

  it('is a plain Error, not a DomainError', () => {
    const error = new InvalidKeyError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidKeyError');
    expect(error).not.toHaveProperty('code');
  });
});

describe('TenantCache', () => {
  it('keeps two tenants caching the same name apart (AC-ST-IAM-001-3)', async () => {
    const store = new MemoryStore();
    const cache = new TenantCache(store);

    await cache.set(context(TENANT_A), 'profile', 'value-a');
    await cache.set(context(TENANT_B), 'profile', 'value-b');

    expect(await cache.get(context(TENANT_A), 'profile')).toBe('value-a');
    expect(await cache.get(context(TENANT_B), 'profile')).toBe('value-b');
  });

  it('prefixes every stored key with t:<tenant id>: (AC-ST-IAM-001-3)', async () => {
    const store = new MemoryStore();
    const cache = new TenantCache(store);

    await cache.set(context(TENANT_A), 'profile', 'a');
    await cache.set(context(TENANT_B), 'profile', 'b');

    expect([...store.data.keys()].sort()).toEqual([`t:${TENANT_A}:profile`, `t:${TENANT_B}:profile`].sort());
    for (const key of store.data.keys()) {
      expect(key.startsWith('t:')).toBe(true);
    }
  });

  it('returns null for a miss and never crosses tenants', async () => {
    const cache = new TenantCache(new MemoryStore());
    await cache.set(context(TENANT_A), 'profile', 'a');

    expect(await cache.get(context(TENANT_B), 'profile')).toBeNull();
    expect(await cache.get(context(TENANT_A), 'other')).toBeNull();
  });

  it('forwards the ttl to the store', async () => {
    const store = new MemoryStore();
    const cache = new TenantCache(store);

    await cache.set(context(TENANT_A), 'profile', 'a', 60);
    await cache.set(context(TENANT_A), 'plain', 'b');

    expect(store.ttls.get(`t:${TENANT_A}:profile`)).toBe(60);
    expect(store.ttls.get(`t:${TENANT_A}:plain`)).toBeUndefined();
  });

  it('rejects names that would escape the tenant prefix', async () => {
    const cache = new TenantCache(new MemoryStore());

    await expect(cache.get(context(TENANT_A), 'a*')).rejects.toBeInstanceOf(InvalidKeyError);
    await expect(cache.set(context(TENANT_A), '', 'v')).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it('rejects a context whose tenant id is not a UUID', async () => {
    const cache = new TenantCache(new MemoryStore());

    await expect(cache.get(context('not-a-uuid'), 'x')).rejects.toBeInstanceOf(InvalidKeyError);
  });
});
