import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ControlDatabase } from '@machvon/db';
import { bearerOf } from '../auth/auth.guard';
import { sessionExpired } from '../auth/jwt';
import type { TokenVerifier, VerifiedIdentity } from '../auth/token-verifier';

export const IDENTITY_OPTIONS = Symbol('IDENTITY_OPTIONS');
export const IDENTITY_COMMAND_METADATA_KEY = 'machvon:identity-command';

/**
 * Marks a command that runs before a tenant is chosen: it authenticates with an identity token (IdentityGuard) and
 * has no tenant principal, so it cannot use the command interceptor and runs its own idempotent, audited pipeline.
 * The command gate (`npm run commands:check`) accepts it in place of @Command.
 */
export const IdentityCommand = (operation: string): MethodDecorator => SetMetadata(IDENTITY_COMMAND_METADATA_KEY, operation);
/** Request property that the identity guard fills with the verified person. */
export const IDENTITY_REQUEST_KEY = 'identityContext';

export interface IdentityGuardOptions {
  verifier: TokenVerifier;
  control: ControlDatabase;
}

/** Who is asking, before any tenant is chosen: the verified identity token and the account it belongs to. */
export interface IdentityContext {
  identity: VerifiedIdentity;
  userAccountId: string;
}

interface IdentityRequest {
  headers: Record<string, string | string[] | undefined>;
  [IDENTITY_REQUEST_KEY]?: IdentityContext;
}

/**
 * Authenticates the routes that run before a tenant is chosen (selectTenantContext): the Bearer token must be an
 * identity token of the tenant client, verified by the TokenVerifier port, and its subject must name an Active
 * user account. A forged token never reaches the account lookup; an unknown, Locked or Disabled account is
 * answered exactly like a bad token (401 SESSION_EXPIRED, no detail), so the answer reveals nothing about accounts.
 */
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(@Inject(IDENTITY_OPTIONS) private readonly options: IdentityGuardOptions) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const token = bearerOf(request.headers.authorization);
    if (token === undefined) throw sessionExpired();
    const identity = await this.options.verifier.verifyIdentity(token);
    if (identity.audience !== 'tenant-client') throw sessionExpired();
    const accounts = await this.options.control.withControl((tx) =>
      tx.query<{ id: string; status: string }>('select id, status from machvon.user_account where idp_subject = $1', [identity.subject]),
    );
    const account = accounts[0];
    if (account === undefined || account.status !== 'Active') throw sessionExpired();
    request[IDENTITY_REQUEST_KEY] = { identity, userAccountId: account.id };
    return true;
  }
}

/** The IdentityContext the identity guard put on the request. */
export const CurrentIdentity = createParamDecorator((_data: unknown, context: ExecutionContext): IdentityContext => {
  const found = context.switchToHttp().getRequest<IdentityRequest>()[IDENTITY_REQUEST_KEY];
  if (found === undefined) throw sessionExpired();
  return found;
});
