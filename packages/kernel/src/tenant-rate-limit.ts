import { DomainError } from './errors.ts';
import { asUuid } from './tenant-context.ts';

export interface TenantRateLimiterOptions {
  /** Requests a tenant may make in one window. */
  limit: number;
  windowSeconds: number;
  /** Milliseconds since the epoch; tests inject it. */
  now?: () => number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  /** Whole seconds until the tenant's window ends; 0 while requests are allowed. */
  retryAfterSeconds: number;
}

interface Window {
  start: number;
  count: number;
}

/**
 * A fixed-window request limiter with one counter per tenant, so a tenant that spends its quota is refused while every
 * other tenant keeps its own (SAS-02 AC-3, quota fairness). Counters of tenants that have been idle for a whole window
 * are dropped, which keeps the table bounded by the number of active tenants.
 */
export class TenantRateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: TenantRateLimiterOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) throw new RangeError('rate limit must be a positive integer');
    if (!Number.isFinite(options.windowSeconds) || options.windowSeconds <= 0) throw new RangeError('rate limit window must be positive');
    this.limit = options.limit;
    this.windowMs = options.windowSeconds * 1000;
    this.now = options.now ?? Date.now;
  }

  consume(tenantId: string): RateLimitVerdict {
    const tenant = asUuid(tenantId);
    if (tenant === undefined) throw new DomainError('TENANT_CONTEXT_INVALID', 400, 'tenantId');
    const now = this.now();
    this.sweep(now);
    const current = this.windows.get(tenant);
    const window = current !== undefined && now - current.start < this.windowMs ? current : { start: now, count: 0 };
    this.windows.set(tenant, window);
    if (window.count >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000)) };
    }
    window.count += 1;
    return { allowed: true, remaining: this.limit - window.count, retryAfterSeconds: 0 };
  }

  /** Number of tenants with a counter, for tests of the sweep. */
  size(): number {
    return this.windows.size;
  }

  private sweep(now: number): void {
    for (const [tenant, window] of this.windows) if (now - window.start >= this.windowMs) this.windows.delete(tenant);
  }
}
