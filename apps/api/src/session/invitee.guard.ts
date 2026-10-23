import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import { bearerOf } from '../auth/auth.guard';
import { sessionExpired } from '../auth/jwt';
import type { VerifiedIdentity } from '../auth/token-verifier';
import { IDENTITY_OPTIONS } from './identity.guard';
import type { IdentityGuardOptions } from './identity.guard';

/** Request property that the invitee guard fills with the verified identity. */
export const INVITEE_REQUEST_KEY = 'inviteeIdentity';

interface InviteeRequest {
  headers: Record<string, string | string[] | undefined>;
  [INVITEE_REQUEST_KEY]?: VerifiedIdentity;
}

/**
 * Authenticates the person who accepts an invitation. Like the identity guard it verifies the identity token of the
 * tenant client, but it does not look the person up: an invited person has no account bound to their identity yet
 * (the invitation holds a shell account that accepting binds), so the account is found from the invitation.
 */
@Injectable()
export class InviteeGuard implements CanActivate {
  constructor(@Inject(IDENTITY_OPTIONS) private readonly options: IdentityGuardOptions) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<InviteeRequest>();
    const token = bearerOf(request.headers.authorization);
    if (token === undefined) throw sessionExpired();
    const identity = await this.options.verifier.verifyIdentity(token);
    if (identity.audience !== 'tenant-client') throw sessionExpired();
    request[INVITEE_REQUEST_KEY] = identity;
    return true;
  }
}

/** The identity the invitee guard put on the request. */
export const CurrentInvitee = createParamDecorator((_data: unknown, context: ExecutionContext): VerifiedIdentity => {
  const found = context.switchToHttp().getRequest<InviteeRequest>()[INVITEE_REQUEST_KEY];
  if (found === undefined) throw sessionExpired();
  return found;
});
