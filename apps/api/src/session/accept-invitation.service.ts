import { createHash, randomUUID } from 'node:crypto';
import { MemberStore, bumpScopeVersion, enqueueOutbox } from '@machvon/db';
import type { AuditWriter, ControlDatabase, IdempotencyStore, InvitationRecord, MemberRecord, StoredResponse, TenantDatabase } from '@machvon/db';
import { DomainError, requestHashOf } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { hashEmail, parseInvitationToken, sameHash } from '../modules/adm/invitation-token';
import type { VerifiedIdentity } from '../auth/token-verifier';
import type { SelectTenantOutcome, SelectTenantService } from './select-tenant.service';

export const ACCEPT_INVITATION_OPERATION = 'acceptInvitation';
const RETRY_AFTER_SECONDS = '2';
const UNIQUE_VIOLATION = '23505';
const SHELL_SUBJECT_PREFIX = 'invitation:';
const NO_HASH = '0'.repeat(64);

export interface AcceptInvitationRequest {
  identity: VerifiedIdentity;
  invitationId: string;
  token: string;
  keyHash: string;
  requestHash: string;
  ipHash: string;
  userAgentSummary: string;
  correlationId: string;
}

export interface AcceptInvitationServiceOptions {
  control: ControlDatabase;
  tenants: TenantDatabase;
  idempotency: IdempotencyStore;
  audit: AuditWriter;
  select: SelectTenantService;
}

/** What the idempotency record keeps of an acceptance: which membership became Active. */
interface StoredAcceptance {
  tenant_id: string;
  membership_id: string;
  user_account_id: string;
}

interface Snapshot {
  invitation: InvitationRecord;
  member: MemberRecord;
}

function isStored(value: unknown): value is StoredAcceptance {
  return typeof value === 'object' && value !== null && typeof (value as StoredAcceptance).membership_id === 'string';
}

function inProgress(): DomainError {
  return new DomainError('IDEMPOTENCY_IN_PROGRESS', 409, undefined, { headers: { 'Retry-After': RETRY_AFTER_SECONDS } });
}

/** A token that names nothing usable is the same answer whatever the reason: unknown invitation, wrong secret, other tenant. */
function unknownInvitation(): DomainError {
  return new DomainError('RESOURCE_NOT_FOUND', 404);
}

/**
 * acceptInvitation (IAM 3.3). The person holds an identity token but no tenant token, so the command runs here, like
 * the tenant selection, with its own idempotent and audited pipeline. The token names its tenant, so the lookup never
 * crosses tenants; an invitation that does not match its token is answered exactly like one that does not exist.
 * Order of checks: the token and the invitation, the verified email of the person, then (under the invitation's row
 * lock) the state of the invitation and the seats. The answer is the session of the new membership, made by the
 * tenant selection under a key derived from the acceptance, so a retry reaches the same session.
 */
export class AcceptInvitationService {
  private readonly members = new MemberStore();

  constructor(private readonly options: AcceptInvitationServiceOptions) {}

  async accept(request: AcceptInvitationRequest): Promise<SelectTenantOutcome> {
    const parsed = parseInvitationToken(request.token);
    if (parsed === undefined) throw unknownInvitation();
    const snapshot = await this.snapshotOf(parsed.tenantId, request.invitationId, parsed.hash);
    this.assertEmail(request.identity, snapshot.invitation);

    const ctx: TenantContext = { tenantId: parsed.tenantId, membershipId: snapshot.member.id, scopeVersion: 0 };
    const ids = { requestId: randomUUID(), correlationId: request.correlationId };
    const keyHash = createHash('sha256').update(`${request.keyHash}:${request.invitationId}`).digest('hex');
    const begin = await this.options.idempotency.begin(ctx, { operation: ACCEPT_INVITATION_OPERATION, keyHash, requestHash: request.requestHash, ttl: 'standard' });
    switch (begin.kind) {
      case 'conflict':
        throw new DomainError('IDEMPOTENCY_CONFLICT', 409);
      case 'in_progress':
        throw inProgress();
      case 'replay': {
        if (begin.response.kind === 'problem') {
          const { code, status, detail, extensions } = begin.response;
          throw new DomainError(code, status, detail, { extensions, headers: { 'Idempotency-Replayed': 'true' } });
        }
        if (!isStored(begin.response.body)) throw new Error('stored invitation acceptance is malformed');
        const replayed = await this.signIn(request, begin.response.body, keyHash);
        return { body: replayed.body, replayed: true };
      }
      case 'started':
        break;
    }

    let ownsRecord = true;
    let expiredCommitted = false;
    try {
      await this.bindAccount(request.identity, snapshot.member.userAccountId);
      const stored = await this.options.tenants.withTenant(ctx, async (tx) => {
        if (!(await this.options.idempotency.claimInTx(tx, begin.recordId))) {
          ownsRecord = false;
          throw inProgress();
        }
        const invitation = await this.members.findInvitation(tx, request.invitationId, { forUpdate: true });
        // The secret is compared again on the locked row, so a rotated or replaced invitation cannot be accepted with an old token.
        if (invitation === undefined || !sameHash(invitation.tokenHash, parsed.hash)) throw unknownInvitation();
        if (invitation.status !== 'Pending') throw new DomainError('INVITATION_EXPIRED', 409);
        const member = await this.members.lockMember(tx, invitation.membershipId);
        if (member === undefined || member.status !== 'Invited') throw new DomainError('INVITATION_EXPIRED', 409);
        if (invitation.expired) {
          // The expiry must outlive the refusal, so it is written in this transaction and the refusal follows its commit.
          await this.members.expireInvitation(tx, invitation.id, member.id);
          expiredCommitted = true;
          return undefined;
        }
        await this.members.assertSeatFree(tx, member.membershipType);
        const version = await this.members.setStatus(tx, member.id, 'Active');
        await this.members.markInvitationAccepted(tx, invitation.id);
        await bumpScopeVersion(tx, [member.id]);
        await enqueueOutbox(tx, {
          aggregateType: 'membership',
          aggregateId: member.id,
          aggregateVersion: version,
          type: 'iam.membership.activated.v1',
          schemaVersion: 1,
          payload: { membership_id: member.id, type: member.membershipType, unit_id: member.organizationId },
          eventKey: `iam.membership.activated.v1:${member.id}:${version}`,
          correlationId: ids.correlationId,
        });
        await this.options.audit.recordInTx(tx, member.id, {
          action: 'membership.invitation_accepted',
          resourceType: 'membership',
          resourceId: member.id,
          diff: { invitation_id: invitation.id, from: 'Invited', to: 'Active' },
          ...ids,
        });
        const result: StoredAcceptance = { tenant_id: parsed.tenantId, membership_id: member.id, user_account_id: member.userAccountId };
        await this.options.idempotency.completeInTx(tx, begin.recordId, { httpStatus: 200, response: { kind: 'success', body: result }, resourceType: 'membership', resourceId: member.id });
        return result;
      });
      if (expiredCommitted || stored === undefined) throw new DomainError('INVITATION_EXPIRED', 409);
      return { body: (await this.signIn(request, stored, keyHash)).body, replayed: false };
    } catch (error) {
      if (ownsRecord) await this.settle(ctx, begin.recordId, error);
      throw error;
    }
  }

  /** The invitation and its membership as the token names them; every failure is the one 404 of an unknown invitation. */
  private async snapshotOf(tenantId: string, invitationId: string, tokenHash: string): Promise<Snapshot> {
    // The membership of the context is not known before the invitation is read; the invitation id stands in, as the
    // transaction only needs the tenant for row-level security.
    const ctx: TenantContext = { tenantId, membershipId: invitationId, scopeVersion: 0 };
    const found = await this.options.tenants.withTenant(ctx, async (tx) => {
      const invitation = await this.members.findInvitation(tx, invitationId);
      const member = invitation === undefined ? undefined : await this.members.membershipOf(tx, invitation.membershipId);
      return invitation === undefined || member === undefined ? undefined : { invitation, member };
    });
    // Compared whether or not an invitation was found, so the work does not tell the two cases apart.
    const matches = sameHash(found?.invitation.tokenHash ?? NO_HASH, tokenHash);
    if (found === undefined || !matches) throw unknownInvitation();
    return found;
  }

  /** The verified email of the identity must be the invited one (BR-IAM: the invitation is for a person, not for whoever holds the link). */
  private assertEmail(identity: VerifiedIdentity, invitation: InvitationRecord): void {
    const verified = identity.emailVerified === true && identity.email !== undefined;
    if (!verified || !sameHash(hashEmail(identity.email ?? ''), invitation.emailHash)) throw new DomainError('INVITATION_EMAIL_MISMATCH', 403);
  }

  /**
   * Binds the identity to the account the invitation created for it. An account that already belongs to this identity is
   * left alone; one that belongs to another identity, or an identity that already has an account of another email, is a
   * mismatch. Control-plane work: the application role cannot reach user_account.
   */
  private async bindAccount(identity: VerifiedIdentity, userAccountId: string): Promise<void> {
    await this.options.control.withControl(async (tx) => {
      const rows = await tx.query<{ idp_subject: string; status: string }>('select idp_subject, status from machvon.user_account where id = $1::uuid for update', [userAccountId]);
      const account = rows[0];
      if (account === undefined) throw unknownInvitation();
      if (account.status !== 'Active') throw new DomainError('MEMBERSHIP_INACTIVE', 403);
      if (account.idp_subject === identity.subject) return;
      if (!account.idp_subject.startsWith(SHELL_SUBJECT_PREFIX)) throw new DomainError('INVITATION_EMAIL_MISMATCH', 403);
      try {
        await tx.query('update machvon.user_account set idp_subject = $2, version = version + 1, updated_at = now() where id = $1::uuid', [userAccountId, identity.subject]);
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new DomainError('INVITATION_EMAIL_MISMATCH', 403);
        throw error;
      }
    });
  }

  /** The session of the new membership: the tenant selection under a key of its own, so a retry of the acceptance reaches the same session. */
  private signIn(request: AcceptInvitationRequest, stored: StoredAcceptance, keyHash: string): Promise<SelectTenantOutcome> {
    return this.options.select.select({
      identity: request.identity,
      userAccountId: stored.user_account_id,
      tenantId: stored.tenant_id,
      membershipId: stored.membership_id,
      keyHash,
      requestHash: requestHashOf({ body: { tenant_id: stored.tenant_id, membership_id: stored.membership_id }, pathParams: {}, ifMatch: null }),
      ipHash: request.ipHash,
      userAgentSummary: request.userAgentSummary,
      correlationId: request.correlationId,
    });
  }

  // The transaction rolled back: a definitive 4xx answer is stored and replays, anything else may be retried.
  private async settle(ctx: TenantContext, recordId: string, error: unknown): Promise<void> {
    const { idempotency } = this.options;
    if (error instanceof DomainError && error.status >= 400 && error.status < 500) {
      const response: StoredResponse = { kind: 'problem', code: error.code, status: error.status, detail: error.detail, extensions: error.extensions };
      await idempotency.finishOutsideTx(ctx, recordId, { retryable: false, httpStatus: error.status, response });
    } else {
      await idempotency.finishOutsideTx(ctx, recordId, { retryable: true });
    }
  }
}
