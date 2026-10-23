import { WORKER_MEMBERSHIP_ID } from '@machvon/db';
import type { TenantContext } from '@machvon/kernel';
import { UserSessionDenyList } from '../../src/session/user-session-deny-list';

const TENANT = '00000000-0000-4000-8000-00000000000a';
const SESSION = '00000000-0000-4000-8000-0000000000b1';

class FakeStore {
  readonly calls: Array<{ ctx: TenantContext; sessionId: string }> = [];
  revoked = false;
  failure: Error | undefined;

  isRevoked(ctx: TenantContext, sessionId: string): Promise<boolean> {
    this.calls.push({ ctx, sessionId });
    return this.failure === undefined ? Promise.resolve(this.revoked) : Promise.reject(this.failure);
  }
}

function setup() {
  const store = new FakeStore();
  let now = 1_000_000;
  const denyList = new UserSessionDenyList(store, { negativeTtlMs: 5_000, now: () => now });
  return { store, denyList, advance: (ms: number) => (now += ms) };
}

describe('UserSessionDenyList', () => {
  it('asks the session store in the tenant of the token, as a worker identity', async () => {
    const { store, denyList } = setup();
    expect(await denyList.isRevoked(SESSION, TENANT)).toBe(false);
    expect(store.calls).toEqual([{ ctx: { tenantId: TENANT, membershipId: WORKER_MEMBERSHIP_ID, scopeVersion: 0 }, sessionId: SESSION }]);
  });

  it('answers "not revoked" from memory for 5 seconds, then asks the store again', async () => {
    const { store, denyList, advance } = setup();
    await denyList.isRevoked(SESSION, TENANT);
    advance(4_999);
    await denyList.isRevoked(SESSION, TENANT);
    expect(store.calls).toHaveLength(1);
    advance(2);
    await denyList.isRevoked(SESSION, TENANT);
    expect(store.calls).toHaveLength(2);
  });

  it('sees a revocation made in another process within the cache time', async () => {
    const { store, denyList, advance } = setup();
    expect(await denyList.isRevoked(SESSION, TENANT)).toBe(false);
    store.revoked = true;
    advance(5_001);
    expect(await denyList.isRevoked(SESSION, TENANT)).toBe(true);
  });

  it('keeps a revoked answer for good: a revocation is final and needs no second look', async () => {
    const { store, denyList, advance } = setup();
    store.revoked = true;
    expect(await denyList.isRevoked(SESSION, TENANT)).toBe(true);
    store.revoked = false;
    advance(3_600_000);
    expect(await denyList.isRevoked(SESSION, TENANT)).toBe(true);
    expect(store.calls).toHaveLength(1);
  });

  it('revokes at once in this process when told, before the store is consulted', async () => {
    const { store, denyList } = setup();
    await denyList.isRevoked(SESSION, TENANT);
    denyList.revoke(SESSION);
    expect(await denyList.isRevoked(SESSION, TENANT)).toBe(true);
    expect(store.calls).toHaveLength(1);
  });

  it('does not track a session that has no tenant (identity-provider sessions of control tokens)', async () => {
    const { store, denyList } = setup();
    expect(await denyList.isRevoked(SESSION)).toBe(false);
    expect(store.calls).toHaveLength(0);
  });

  it('fails closed when the store fails: the error reaches the caller and nothing is cached as "not revoked"', async () => {
    const { store, denyList } = setup();
    store.failure = new Error('database down');
    await expect(denyList.isRevoked(SESSION, TENANT)).rejects.toThrow('database down');
    store.failure = undefined;
    store.revoked = true;
    expect(await denyList.isRevoked(SESSION, TENANT)).toBe(true);
  });

  it('keeps its memory bounded: old "not revoked" answers are dropped once expired', async () => {
    const { store, denyList, advance } = setup();
    for (let n = 0; n < 50; n += 1) await denyList.isRevoked(`00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`, TENANT);
    advance(5_001);
    await denyList.isRevoked(SESSION, TENANT);
    expect(denyList.cachedCount()).toBe(1);
    expect(store.calls).toHaveLength(51);
  });
});
