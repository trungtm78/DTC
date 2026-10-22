import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { DomainError } from '@machvon/kernel';
import type { EffectiveAccess } from '@machvon/kernel';
import { ACCESS_REQUEST_KEY } from './policy.guard';

/** The EffectiveAccess the policy guard decided on; without the guard there is no caller identity to act on. */
export const CurrentAccess = createParamDecorator((_data: unknown, context: ExecutionContext): EffectiveAccess => {
  const access = context.switchToHttp().getRequest<{ [ACCESS_REQUEST_KEY]?: EffectiveAccess }>()[ACCESS_REQUEST_KEY];
  if (access === undefined) throw new DomainError('SESSION_EXPIRED', 401);
  return access;
});
