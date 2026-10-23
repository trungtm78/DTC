import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { TenantBootstrapStore } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import { commandResult } from '../../command-result';
import type { CommandResult } from '../../command-result';
import { Command, Scope } from '../../command.decorator';
import type { CommandScope } from '../../command-scope';
import type { Schemas } from '../../contract-types';
import { OperationId } from '../../operation-id.decorator';
import { INVITATION_TTL_DAYS, createInvitationToken, hashEmail } from '../adm/invitation-token';
import { INVITATION_MAILER } from '../adm/invitation-mailer';
import type { InvitationMailer } from '../adm/invitation-mailer';
import { ownerAssignedEvents } from './tenant-owner';

const DAY_MS = 86_400_000;
const MAX_EMAIL_LENGTH = 254;

// The contract names the format `email` but the validator does not enforce it, and the account function refuses anything else.
const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= MAX_EMAIL_LENGTH;

/**
 * assignTenantOwner (SAS 3.1, BR-IAM-05): the only way to name a TENANT_OWNER after provisioning, and it exists on the control
 * plane only. The person is invited into the root unit with the grant; an earlier pending invitation of the same person is
 * revoked and replaced (this is how an invitation is sent again), and so is the pending owner invitation of anyone else. The
 * transaction acts as the tenant while it writes, so the audit row and the events belong to that tenant; the token goes to
 * the mailer once the command committed and is never stored, logged or written to an audit row or an event.
 */
@Controller('system/tenants')
export class TenantOwnerController {
  constructor(
    @Inject(TenantBootstrapStore) private readonly bootstrap: TenantBootstrapStore,
    @Inject(INVITATION_MAILER) private readonly mailer: InvitationMailer,
  ) {}

  @Post(':tenantId/owners')
  @HttpCode(201)
  @OperationId('assignTenantOwner')
  @Command({ operation: 'assignTenantOwner', plane: 'control' })
  async assign(@Scope() scope: CommandScope, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() body: Schemas['TenantOwnerAssign']): Promise<CommandResult> {
    if (!isEmail(body.user_email)) throw new DomainError('VALIDATION_FAILED', 422, 'user_email');
    const known = await scope.tx.query('select 1 from machvon.tenant where id = $1::uuid', [tenantId]);
    if (known.length === 0) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    const issuedAt = new Date();
    const { token, hash } = createInvitationToken(tenantId);
    const expiresAt = new Date(issuedAt.getTime() + INVITATION_TTL_DAYS * DAY_MS);

    await scope.tx.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const assigned = await this.bootstrap.assignOwner(scope.tx, { email: body.user_email, assignedBy: scope.tenant.membershipId, tokenHash: hash, emailHash: hashEmail(body.user_email), expiresAt });
    await scope.audit({
      action: 'tenant.owner_assigned',
      resourceType: 'tenant',
      resourceId: tenantId,
      reason: body.reason.trim(),
      diff: { membership_id: assigned.membershipId, request_document_ref: body.request_document_ref, replaced: assigned.superseded.length },
    });
    for (const event of ownerAssignedEvents(tenantId, assigned)) await scope.emit(event);
    await scope.tx.query("select set_config('app.tenant_id', $1, true)", [scope.tenant.tenantId]);

    const { invitationId } = assigned;
    if (invitationId !== undefined) {
      scope.afterCommit(() => this.mailer.send({ tenantId, invitationId, toEmail: body.user_email.trim().toLowerCase(), token, expiresAt }));
    }
    return commandResult(scope, 'OWNER_ASSIGNED', 1, assigned.membershipId);
  }
}
