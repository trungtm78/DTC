import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { parseTenantContext } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';

/** Request property that the authentication guard fills with the verified TenantContext. */
export const TENANT_REQUEST_KEY = 'tenantContext';

/** The request's TenantContext; a request that no guard authenticated fails with TENANT_CONTEXT_INVALID. */
export function tenantContextOf(request: { [TENANT_REQUEST_KEY]?: unknown }): TenantContext {
  return parseTenantContext(request[TENANT_REQUEST_KEY]);
}

export const CurrentTenant = createParamDecorator((_data: unknown, context: ExecutionContext): TenantContext =>
  tenantContextOf(context.switchToHttp().getRequest<{ [TENANT_REQUEST_KEY]?: unknown }>()),
);
