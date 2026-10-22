import type { TenantCache } from '../../src/tenant-keys.ts';
import type { TenantContext } from '../../src/tenant-context.ts';

export function readThroughCache(cache: TenantCache, ctx: TenantContext): Promise<string | null> {
  return cache.get(ctx, 'session');
}
