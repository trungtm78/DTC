import { WORKER_MEMBERSHIP_ID } from '@machvon/db';
import type { TenantDatabase } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { TenantAccessPolicy } from '@machvon/kernel';

/** Injection token of the live tenant state; without a provider the token claim `mode` alone decides. */
export const TENANT_RUNTIME = Symbol('TENANT_RUNTIME');

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_MAX_AGE_MS = 1000;
const POLICIES: readonly TenantAccessPolicy[] = ['FULL', 'READ_ONLY_EXPORT', 'NO_ACCESS'];

/** What the control plane says a tenant may do right now (`tenant_runtime`, SAS 3.1). */
export interface TenantRuntime {
  status: string;
  accessPolicy: TenantAccessPolicy;
  /** While a placement cutover runs, writes are refused until this time. */
  writeFrozenUntil: Date | null;
}

export interface TenantRuntimeSource {
  /** The state of the tenant, or undefined for a tenant that has no row (test fixtures). */
  of(tenantId: string): Promise<TenantRuntime | undefined>;
  /** Forgets what is held about the tenant: called by the command that changes its state. */
  invalidate(tenantId: string): void;
}

/**
 * The answer to a request given the live state of its tenant, or undefined when it may go on. An Active tenant allows
 * everything; a suspended one reads and exports (READ_ONLY_EXPORT) or nothing at all (NO_ACCESS, a security incident);
 * a placement cutover refuses commands with a retryable 503 until the freeze ends.
 */
export function runtimeVerdict(
  runtime: TenantRuntime | undefined,
  request: { method: string; isExport: boolean },
  now: Date,
): DomainError | undefined {
  if (runtime === undefined) return undefined;
  if (runtime.accessPolicy === 'NO_ACCESS') return new DomainError('TENANT_SUSPENDED', 403);
  const isRead = READ_METHODS.has(request.method.toUpperCase());
  if (runtime.accessPolicy === 'READ_ONLY_EXPORT' && !isRead && !request.isExport) return new DomainError('TENANT_SUSPENDED', 403);
  if (!isRead && runtime.writeFrozenUntil !== null && runtime.writeFrozenUntil.getTime() > now.getTime()) {
    return new DomainError('TENANT_WRITE_FROZEN', 503);
  }
  return undefined;
}

interface RuntimeRow {
  status: string;
  access_policy: string;
  write_frozen_until: Date | null;
}

interface Held {
  runtime: TenantRuntime | undefined;
  readAt: number;
}

/**
 * Reads `tenant_runtime` through the tenant plane (the function answers the application role only for the tenant of
 * its own transaction) and keeps the answer for a very short time. A command that changes the state calls
 * `invalidate`, so in the process that ran it the next request already sees the new state; another process sees it
 * within `maxAgeMs`.
 */
export class DatabaseTenantRuntime implements TenantRuntimeSource {
  private readonly held = new Map<string, Held>();
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor(
    private readonly database: TenantDatabase,
    options: { maxAgeMs?: number; now?: () => number } = {},
  ) {
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
  }

  async of(tenantId: string): Promise<TenantRuntime | undefined> {
    const kept = this.held.get(tenantId);
    if (kept !== undefined && this.now() - kept.readAt <= this.maxAgeMs) return kept.runtime;
    const rows = await this.database.withTenant({ tenantId, membershipId: WORKER_MEMBERSHIP_ID, scopeVersion: 0 }, (tx) =>
      tx.query<RuntimeRow>('select status, access_policy, write_frozen_until from machvon.tenant_runtime($1::uuid)', [tenantId]),
    );
    const row = rows[0];
    // An unknown policy must never widen access: it is read as no access at all.
    const runtime =
      row === undefined
        ? undefined
        : { status: row.status, accessPolicy: POLICIES.find((policy) => policy === row.access_policy) ?? 'NO_ACCESS', writeFrozenUntil: row.write_frozen_until };
    this.held.set(tenantId, { runtime, readAt: this.now() });
    return runtime;
  }

  invalidate(tenantId: string): void {
    this.held.delete(tenantId);
  }
}
