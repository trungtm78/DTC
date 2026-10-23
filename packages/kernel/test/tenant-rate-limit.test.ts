import { TenantRateLimiter } from '../src/index';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';

describe('TenantRateLimiter', () => {
  let clock = 1_000_000;
  const limiter = new TenantRateLimiter({ limit: 3, windowSeconds: 60, now: () => clock });

  it('allows the quota of a tenant and refuses the next request with a retry hint', () => {
    expect(limiter.consume(TENANT_A)).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
    expect(limiter.consume(TENANT_A).remaining).toBe(1);
    expect(limiter.consume(TENANT_A).remaining).toBe(0);
    const refused = limiter.consume(TENANT_A);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBe(60);
  });

  it('leaves another tenant untouched while the first is over its quota (AC-ST-SAS-002-3)', () => {
    expect(limiter.consume(TENANT_B)).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
  });

  it('counts down the retry hint and opens a new window when the old one has passed', () => {
    clock += 45_500;
    expect(limiter.consume(TENANT_A)).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 15 });
    clock += 14_500;
    expect(limiter.consume(TENANT_A)).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
  });

  it('forgets idle tenants so the table does not grow without bound', () => {
    const fresh = new TenantRateLimiter({ limit: 1, windowSeconds: 1, now: () => clock });
    for (let n = 1; n <= 200; n += 1) fresh.consume(`00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`);
    expect(fresh.size()).toBe(200);
    clock += 2_000;
    fresh.consume(TENANT_A);
    expect(fresh.size()).toBe(1);
  });

  it('rejects a tenant id that is not a UUID and options that make no sense', () => {
    expect(() => limiter.consume('not-a-uuid')).toThrow();
    expect(() => new TenantRateLimiter({ limit: 0, windowSeconds: 60 })).toThrow(RangeError);
    expect(() => new TenantRateLimiter({ limit: 1.5, windowSeconds: 60 })).toThrow(RangeError);
    expect(() => new TenantRateLimiter({ limit: 1, windowSeconds: 0 })).toThrow(RangeError);
  });

  it('uses the real clock by default', () => {
    expect(new TenantRateLimiter({ limit: 1, windowSeconds: 60 }).consume(TENANT_A).allowed).toBe(true);
  });
});
