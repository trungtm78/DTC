import type { EffectiveAccess } from '@machvon/kernel';
import { InMemoryAuthzCache } from '../src/authz-cache';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const MEMBER_1 = '00000000-0000-4000-8000-0000000000f1';
const MEMBER_2 = '00000000-0000-4000-8000-0000000000f2';

function accessOf(membershipId: string, scopeVersion: number): EffectiveAccess {
  return {
    membershipId,
    scopeVersion,
    membershipActive: true,
    grants: [
      {
        roleCode: 'UNIT_ADMIN',
        rank: 70,
        permissions: ['iam.unit.manage'],
        scope: { kind: 'UNIT_SUBTREE', refIds: ['u1'], paths: ['/u1/'] },
        status: 'Active',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2027-01-01T00:00:00.000Z'),
      },
      {
        roleCode: 'MEMBER',
        rank: 5,
        permissions: ['profile.self'],
        scope: { kind: 'TENANT' },
        status: 'Active',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveUntil: null,
      },
    ],
  };
}

describe('InMemoryAuthzCache', () => {
  let clock = 1_000_000;
  const cache = new InMemoryAuthzCache(() => clock);

  beforeEach(async () => {
    clock = 1_000_000;
    await cache.invalidate(TENANT_A, MEMBER_1);
    await cache.invalidate(TENANT_A, MEMBER_2);
    await cache.invalidate(TENANT_B, MEMBER_1);
  });

  it('round-trips an access with its dates restored as Date objects', async () => {
    const access = accessOf(MEMBER_1, 3);
    await cache.set(access, TENANT_A, 60);
    const hit = await cache.get(TENANT_A, MEMBER_1, 3);
    expect(hit).toEqual(access);
    expect(hit?.grants[0]?.effectiveFrom).toBeInstanceOf(Date);
    expect(hit?.grants[1]?.effectiveUntil).toBeNull();
  });

  it('never serves an entry written for another scope_version', async () => {
    await cache.set(accessOf(MEMBER_1, 3), TENANT_A, 60);
    expect(await cache.get(TENANT_A, MEMBER_1, 4)).toBeUndefined();
    expect(await cache.get(TENANT_A, MEMBER_1, 2)).toBeUndefined();
  });

  it('expires an entry after its TTL', async () => {
    await cache.set(accessOf(MEMBER_1, 3), TENANT_A, 60);
    clock += 59_999;
    expect(await cache.get(TENANT_A, MEMBER_1, 3)).toBeDefined();
    clock += 1;
    expect(await cache.get(TENANT_A, MEMBER_1, 3)).toBeUndefined();
  });

  it('keeps tenants apart even when the membership id repeats', async () => {
    await cache.set(accessOf(MEMBER_1, 3), TENANT_A, 60);
    expect(await cache.get(TENANT_B, MEMBER_1, 3)).toBeUndefined();
  });

  it('invalidates every version of one membership and nothing else', async () => {
    await cache.set(accessOf(MEMBER_1, 3), TENANT_A, 60);
    await cache.set(accessOf(MEMBER_1, 4), TENANT_A, 60);
    await cache.set(accessOf(MEMBER_2, 3), TENANT_A, 60);
    await cache.set(accessOf(MEMBER_1, 3), TENANT_B, 60);
    await cache.invalidate(TENANT_A, MEMBER_1);
    expect(await cache.get(TENANT_A, MEMBER_1, 3)).toBeUndefined();
    expect(await cache.get(TENANT_A, MEMBER_1, 4)).toBeUndefined();
    expect(await cache.get(TENANT_A, MEMBER_2, 3)).toBeDefined();
    expect(await cache.get(TENANT_B, MEMBER_1, 3)).toBeDefined();
  });

  it('invalidates every membership of one tenant and nothing of another', async () => {
    await cache.set(accessOf(MEMBER_1, 3), TENANT_A, 60);
    await cache.set(accessOf(MEMBER_2, 4), TENANT_A, 60);
    await cache.set(accessOf(MEMBER_1, 3), TENANT_B, 60);
    await cache.invalidateTenant(TENANT_A);
    expect(await cache.get(TENANT_A, MEMBER_1, 3)).toBeUndefined();
    expect(await cache.get(TENANT_A, MEMBER_2, 4)).toBeUndefined();
    expect(await cache.get(TENANT_B, MEMBER_1, 3)).toBeDefined();
  });

  it('rejects a tenant id that is not a UUID instead of building a key', async () => {
    await expect(cache.get('not-a-uuid', MEMBER_1, 1)).rejects.toThrow();
  });

  it('uses the real clock by default', async () => {
    const real = new InMemoryAuthzCache();
    await real.set(accessOf(MEMBER_1, 1), TENANT_A, 60);
    expect(await real.get(TENANT_A, MEMBER_1, 1)).toBeDefined();
  });

  it('reclaims expired entries without another read of the same key (1000 superseded versions)', async () => {
    const sweeping = new InMemoryAuthzCache(() => clock);
    for (let version = 1; version <= 1000; version += 1) await sweeping.set(accessOf(MEMBER_1, version), TENANT_A, 60);
    expect(sweeping.size()).toBe(1000);
    clock += 61_000;
    // One write after the TTL is enough for the cache to drop what has lapsed.
    await sweeping.set(accessOf(MEMBER_2, 1), TENANT_B, 60);
    expect(sweeping.size()).toBe(1);
    expect(await sweeping.get(TENANT_B, MEMBER_2, 1)).toEqual(accessOf(MEMBER_2, 1));
  });

  it('keeps entries that have not expired when it sweeps', async () => {
    const sweeping = new InMemoryAuthzCache(() => clock);
    await sweeping.set(accessOf(MEMBER_1, 1), TENANT_A, 120);
    await sweeping.set(accessOf(MEMBER_1, 2), TENANT_A, 10);
    clock += 30_000;
    await sweeping.set(accessOf(MEMBER_2, 1), TENANT_A, 60);
    expect(sweeping.size()).toBe(2);
    expect(await sweeping.get(TENANT_A, MEMBER_1, 1)).toBeDefined();
    expect(await sweeping.get(TENANT_A, MEMBER_1, 2)).toBeUndefined();
  });
});
