import { InvalidKeyError } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { TENANT_IDS, UNIT_FIXTURES } from '../suite';
import type { ForeignAttempt, IsolationChannel, TenantName } from '../suite';
import { contextOf } from './database';

/** What the channel needs from a cache: the shape of TenantCache. */
export interface TenantCacheLike {
  get(ctx: TenantContext, name: string): Promise<string | null>;
  set(ctx: TenantContext, name: string, value: string, ttlSeconds?: number): Promise<void>;
}

/** Both tenants cache a value under the same logical name; that name must hold each tenant's own value (AC-ST-KERNEL-024-1). */
export const SHARED_LOGICAL_NAME = 'units';
const unitName = (unitId: string): string => `unit.${unitId}`;

async function read(work: Promise<string | null>): Promise<{ status: number; body: string }> {
  try {
    const value = await work;
    return value === null ? { status: 404, body: '' } : { status: 200, body: value };
  } catch (error) {
    // A name that tries to leave the tenant prefix is refused before the store is reached: nothing was read.
    if (error instanceof InvalidKeyError) return { status: 404, body: '' };
    throw error;
  }
}

/**
 * The cache as a way to read another tenant's data: each tenant caches its units under the same logical name and under
 * the id of each unit. A TNT-A user that asks for the key of a TNT-B unit, or builds a name that reaches into the TNT-B
 * prefix, must get a miss; the shared logical name must return the user's own value.
 */
export function createCacheChannel(cache: TenantCacheLike): IsolationChannel {
  return {
    name: 'cache',
    async seed(tenant) {
      const ctx = contextOf(tenant);
      const units = UNIT_FIXTURES[tenant];
      await cache.set(ctx, SHARED_LOGICAL_NAME, JSON.stringify(units));
      for (const unit of units) await cache.set(ctx, unitName(unit.id), JSON.stringify(unit));
    },
    readAs(user, target) {
      const foreignUnit = UNIT_FIXTURES[target][0]?.id ?? '';
      return read(cache.get(contextOf(user), unitName(foreignUnit)));
    },
    listAs(user) {
      return read(cache.get(contextOf(user), SHARED_LOGICAL_NAME));
    },
    async foreignAttempts(user): Promise<ForeignAttempt[]> {
      const target: TenantName = 'TNT-B';
      const foreignTenant = TENANT_IDS[target];
      const names = [`${foreignTenant}:${SHARED_LOGICAL_NAME}`, `t:${foreignTenant}:${SHARED_LOGICAL_NAME}`, '*', `${SHARED_LOGICAL_NAME}:*`, ''];
      const attempts: ForeignAttempt[] = [];
      for (const name of names) attempts.push({ operation: `cache:name:${attempts.length}`, ...(await read(cache.get(contextOf(user), name))) });
      return attempts;
    },
  };
}
