import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { DomainError, verifyTenantContext } from '@machvon/kernel';
import { TENANT_REQUEST_KEY } from '../../src/tenant-context.decorator';

export const TENANT_HEADER = 'x-tenant-context';
export const TEST_SIGNING_KEY = Symbol('TEST_SIGNING_KEY');

interface GuardedRequest {
  headers: Record<string, string | string[] | undefined>;
  [TENANT_REQUEST_KEY]?: unknown;
}

/**
 * Test-only stand-in for authentication (real authentication arrives with ST-IAM-002): it trusts a
 * TenantContext only when the header carries a token signed with the test key. It is registered by
 * the test module alone, never by AppModule.
 */
@Injectable()
export class TestAuthGuard implements CanActivate {
  private readonly signingKey: Buffer;

  constructor(@Inject(TEST_SIGNING_KEY) signingKey: Buffer) {
    this.signingKey = signingKey;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const token = request.headers[TENANT_HEADER];
    if (typeof token !== 'string') throw new DomainError('TENANT_CONTEXT_INVALID', 400);
    request[TENANT_REQUEST_KEY] = verifyTenantContext(token, this.signingKey);
    return true;
  }
}
