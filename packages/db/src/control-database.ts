import { DomainError, asUuid } from '@machvon/kernel';
import type { Pool } from 'pg';
import { runInTransaction } from './tenant-database.ts';
import type { TenantTx } from './tenant-database.ts';

/**
 * The tenant that stands in for the platform itself: control-plane commands record their idempotency key and the
 * audit rows that are not about one tenant under it, because those tables require a tenant id.
 */
export const PLATFORM_TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

/**
 * The database handle of the control plane. The pool connects as machvon_control: it reaches the control-plane
 * tables directly, and a tenant table only inside a transaction that names the tenant, so row-level security
 * still confines it to that tenant. Lookups across tenants go through the narrow functions of migration V008.
 */
export class ControlDatabase {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** One transaction on the control-plane tables; no tenant setting is made. */
  withControl<T>(work: (tx: TenantTx) => Promise<T>): Promise<T> {
    return runInTransaction(this.pool, undefined, work);
  }

  /** One transaction for the tenant named, for the tenant tables the control role may write. */
  async withTenantOf<T>(tenantId: string, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    // Validate before any connection is taken: an invalid id must never reach the database.
    const id = asUuid(tenantId);
    if (id === undefined) throw new DomainError('TENANT_CONTEXT_INVALID', 400, 'tenantId');
    return await runInTransaction(this.pool, id, work);
  }
}
