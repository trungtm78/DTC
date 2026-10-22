import { asUuid } from './tenant-context.ts';
import type { TenantContext } from './tenant-context.ts';

/** Thrown for malformed cache keys. This is a programming error, never a client-facing DomainError. */
export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeyError';
  }
}

/** Minimal key-value store (for example Redis). Outside this module it must only be reached through TenantCache. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
}

const FORBIDDEN_PART_CHARACTERS = /[*:\s]/;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

// Wildcards, the separator, whitespace and control characters (C0 and DEL) are never allowed in a part.
function isValidPart(part: unknown): part is string {
  return typeof part === 'string' && part.length > 0 && !FORBIDDEN_PART_CHARACTERS.test(part) && !hasControlCharacter(part);
}

/**
 * Builds `t:{tenantId}:{parts joined by ':'}`. The tenant id must be a canonical UUID and is
 * lower-cased. Error messages never echo the offending values.
 */
export function tenantKey(tenantId: string, ...parts: string[]): string {
  const tenant = asUuid(tenantId);
  if (tenant === undefined) {
    throw new InvalidKeyError('Tenant key requires a canonical UUID tenant id');
  }
  if (parts.length === 0) {
    throw new InvalidKeyError('Tenant key requires at least one part');
  }
  for (const part of parts) {
    if (!isValidPart(part)) {
      throw new InvalidKeyError('Tenant key parts must be non-empty without wildcard, separator, whitespace or control characters');
    }
  }
  return `t:${tenant}:${parts.join(':')}`;
}

/** Cache whose every key is prefixed with the caller's tenant id. */
export class TenantCache {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async get(ctx: TenantContext, name: string): Promise<string | null> {
    return this.store.get(tenantKey(ctx.tenantId, name));
  }

  async set(ctx: TenantContext, name: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.store.set(tenantKey(ctx.tenantId, name), value, ttlSeconds);
  }
}
