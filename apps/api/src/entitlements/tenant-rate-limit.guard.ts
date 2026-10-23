import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { DomainError } from '@machvon/kernel';
import type { TenantRateLimiter } from '@machvon/kernel';
import { principalOf } from '../principal';

export const TENANT_RATE_LIMITER = Symbol('TENANT_RATE_LIMITER');

/** Refuses a tenant beyond its request quota with 429 RATE_LIMIT and Retry-After; other tenants keep their own counters. Runs after authentication. */
@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  constructor(@Inject(TENANT_RATE_LIMITER) private readonly limiter: TenantRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const principal = principalOf(context.switchToHttp().getRequest<{ principal?: unknown }>());
    const verdict = this.limiter.consume(principal.tenant.tenantId);
    if (!verdict.allowed) throw new DomainError('RATE_LIMIT', 429, undefined, { headers: { 'Retry-After': String(verdict.retryAfterSeconds) } });
    return true;
  }
}
