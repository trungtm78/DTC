import type { MemberStore } from '@machvon/db';
import type { CommandScope } from '../../command-scope';
import { INVITATION_TTL_DAYS, createInvitationToken, hashEmail } from './invitation-token';
import type { InvitationMailer } from './invitation-mailer';

const DAY_MS = 86_400_000;

/** A stored invitation and the one-time token that goes to the person: the token exists only in memory, only its hash is stored. */
export interface IssuedInvitation {
  id: string;
  token: string;
  expiresAt: Date;
  toEmail: string;
}

/**
 * Stores the pending invitation of a membership in the command transaction (7 days, IAM section 3.3). Staff and guest
 * invitations go through here, so both have the same token, expiry and hash rules.
 */
export async function issueInvitation(scope: CommandScope, members: MemberStore, input: { membershipId: string; email: string; now: Date }): Promise<IssuedInvitation> {
  const { token, hash } = createInvitationToken(scope.tenant.tenantId);
  const expiresAt = new Date(input.now.getTime() + INVITATION_TTL_DAYS * DAY_MS);
  const invitation = await members.insertInvitation(scope.tx, {
    membershipId: input.membershipId,
    emailHash: hashEmail(input.email),
    tokenHash: hash,
    invitedBy: scope.tenant.membershipId,
    expiresAt,
  });
  return { id: invitation.id, token, expiresAt, toEmail: input.email.trim().toLowerCase() };
}

/** Hands the invitation to the mailer; the audit row and the events of the command carry neither the email nor the token. */
export function deliverInvitation(mailer: InvitationMailer, scope: CommandScope, issued: IssuedInvitation): Promise<void> {
  return mailer.send({ tenantId: scope.tenant.tenantId, invitationId: issued.id, toEmail: issued.toEmail, token: issued.token, expiresAt: issued.expiresAt });
}
