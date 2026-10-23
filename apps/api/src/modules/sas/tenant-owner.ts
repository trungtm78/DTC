import type { AssignedOwner, OutboxEventInput } from '@machvon/db';

export const ROLE_GRANT_CREATED_EVENT = 'iam.role_grant.created.v1';
export const MEMBERSHIP_INVITED_EVENT = 'iam.membership.invited.v1';
export const ACCESS_CHANGED_EVENT = 'iam.access.changed.v1';
export const MEMBERSHIP_ENDED_EVENT = 'iam.membership.ended.v1';

type Event = Omit<OutboxEventInput, 'correlationId'>;

/**
 * The events of naming an owner, for the command (`assignTenantOwner`) and for the provisioning step OWNER_INVITE: the new
 * grant and invitation, the end of every pending owner that was replaced, and the change of access of each person touched.
 * The keys include the invitation, so naming the same person twice is two invitations and never a lost event. No event
 * carries an email address or a token.
 */
export function ownerAssignedEvents(tenantId: string, assigned: AssignedOwner): Event[] {
  const events: Event[] = [];
  if (assigned.grantId !== undefined) {
    events.push({
      aggregateType: 'role_grant',
      aggregateId: assigned.grantId,
      aggregateVersion: 1,
      type: ROLE_GRANT_CREATED_EVENT,
      schemaVersion: 1,
      payload: { tenant_id: tenantId, grant_id: assigned.grantId, membership_id: assigned.membershipId, role_code: 'TENANT_OWNER' },
      eventKey: `role-grant-created:${assigned.grantId}`,
    });
  }
  if (assigned.invitationId !== undefined) {
    events.push({
      aggregateType: 'membership',
      aggregateId: assigned.membershipId,
      aggregateVersion: 1,
      type: MEMBERSHIP_INVITED_EVENT,
      schemaVersion: 1,
      payload: { membership_id: assigned.membershipId, type: 'STAFF', unit_id: assigned.unitId },
      eventKey: `membership-invited:${assigned.membershipId}:${assigned.invitationId}`,
    });
  }
  for (const replaced of assigned.superseded) {
    events.push({
      aggregateType: 'membership',
      aggregateId: replaced,
      aggregateVersion: 1,
      type: MEMBERSHIP_ENDED_EVENT,
      schemaVersion: 1,
      payload: { membership_id: replaced, reason: 'OWNER_REPLACED' },
      eventKey: `membership-ended:${replaced}`,
    });
  }
  for (const membershipId of [assigned.membershipId, ...assigned.superseded]) {
    events.push({
      aggregateType: 'membership',
      aggregateId: membershipId,
      aggregateVersion: 1,
      type: ACCESS_CHANGED_EVENT,
      schemaVersion: 1,
      payload: { tenant_id: tenantId, membership_id: membershipId },
      eventKey: `access-changed:${membershipId}:${assigned.invitationId ?? assigned.grantId ?? 'none'}`,
    });
  }
  return events;
}
