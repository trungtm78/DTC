import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '@machvon/contracts';
import { DomainError, featureOf } from '@machvon/kernel';
import { AUTH_TOKEN_REQUEST_KEY } from '../auth/auth.guard';
import type { AuthenticatedToken } from '../auth/auth.guard';
import { operationIdOf } from '../operation-id.decorator';
import { PUBLIC_METADATA_KEY } from '../public.decorator';

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXPORT_FEATURE = 'export';

/**
 * A session issued while the tenant is suspended carries `mode = READ_ONLY` (IAM 3.2, SAS 3.6): it may read and
 * export, never change anything. This guard runs after the authentication guard and before the policy guard, and
 * answers 403 TENANT_SUSPENDED for every command that is not an export (an operation whose permission belongs to
 * the `export` feature).
 */
@Injectable()
export class ReadOnlyModeGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_METADATA_KEY, [context.getHandler(), context.getClass()]) === true) return true;
    const request = context.switchToHttp().getRequest<{ method: string; [AUTH_TOKEN_REQUEST_KEY]?: AuthenticatedToken }>();
    if (request[AUTH_TOKEN_REQUEST_KEY]?.mode !== 'READ_ONLY') return true;
    if (READ_METHODS.has(request.method.toUpperCase())) return true;
    if (isExport(operationIdOf(context.getHandler()))) return true;
    throw new DomainError('TENANT_SUSPENDED', 403);
  }
}

function isExport(operationId: string | undefined): boolean {
  if (operationId === undefined) return false;
  const permission = (PERMISSIONS as Record<string, string>)[operationId];
  return permission !== undefined && featureOf(permission) === EXPORT_FEATURE;
}
