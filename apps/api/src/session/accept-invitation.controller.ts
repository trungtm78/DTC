import { randomUUID } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Inject, Ip, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { asUuid, keyHashOf, parseIdempotencyKey, requestHashOf } from '@machvon/kernel';
import type { VerifiedIdentity } from '../auth/token-verifier';
import { OperationId } from '../operation-id.decorator';
import { Public } from '../public.decorator';
import { assertValidBody } from '../request-validation';
import { ACCEPT_INVITATION_OPERATION, AcceptInvitationService } from './accept-invitation.service';
import { IdentityCommand } from './identity.guard';
import { CurrentInvitee, InviteeGuard } from './invitee.guard';
import { hashIp, summaryOf } from './select-tenant.controller';
import type { SessionContextView } from './select-tenant.service';

interface InvitationAcceptBody {
  token: string;
}

/**
 * POST /memberships/invitations/{invitationId}/accept (acceptInvitation). Like the tenant selection it is not a
 * tenant-plane route: the person holds an identity token, and the invitation names the tenant. The authentication and
 * policy guards skip it (@Public) and the invitee guard authenticates it instead.
 */
@Controller('memberships/invitations')
export class AcceptInvitationController {
  constructor(@Inject(AcceptInvitationService) private readonly service: AcceptInvitationService) {}

  @Post(':invitationId/accept')
  @HttpCode(200)
  @Public()
  @UseGuards(InviteeGuard)
  @OperationId(ACCEPT_INVITATION_OPERATION)
  @IdentityCommand(ACCEPT_INVITATION_OPERATION)
  async accept(
    @CurrentInvitee() identity: VerifiedIdentity,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | string[] | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string | undefined,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown },
  ): Promise<SessionContextView> {
    const idempotencyKey = parseIdempotencyKey(key);
    assertValidBody(ACCEPT_INVITATION_OPERATION, body);
    const outcome = await this.service.accept({
      identity,
      invitationId,
      token: (body as InvitationAcceptBody).token,
      keyHash: keyHashOf(idempotencyKey),
      requestHash: requestHashOf({ body, pathParams: { invitationId }, ifMatch: null }),
      ipHash: hashIp(ip),
      userAgentSummary: summaryOf(userAgent),
      correlationId: asUuid(correlation) ?? randomUUID(),
    });
    if (outcome.replayed) response.setHeader('Idempotency-Replayed', 'true');
    return outcome.body;
  }
}
