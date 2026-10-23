import { effectivePermissions, holdsPermission } from '@machvon/kernel';
import type { EffectiveAccess } from '@machvon/kernel';
import type { NotificationRef } from '@machvon/db';

export type ResourceRef = NonNullable<NotificationRef['resource']>;

/**
 * Whether a member may read the thing a notification is about. A notification never carries record data: its
 * content is shown only while this answers true, and "content unavailable" is shown instead when it does not
 * (NOT 3.2). The check is synchronous over an already loaded EffectiveAccess, so a list of notifications costs
 * one access load.
 */
export interface ResourceAccessPort {
  canRead(access: EffectiveAccess, resource: ResourceRef, now: Date): boolean;
}

/**
 * The default port: the member needs the `<resource type>.read` permission. When the event names the owner unit
 * (id and path) the permission must come from a grant whose scope contains that unit; without them the
 * permission alone decides. Modules with a richer rule register their own port.
 */
export class PermissionResourceAccess implements ResourceAccessPort {
  canRead(access: EffectiveAccess, resource: ResourceRef, now: Date): boolean {
    if (!access.membershipActive) return false;
    const permission = `${resource.type}.read`;
    const scoped =
      resource.ownerUnitId !== undefined && resource.ownerUnitPath !== undefined
        ? { ownerUnitId: resource.ownerUnitId, ownerUnitPath: resource.ownerUnitPath, projectId: resource.projectId, contractId: resource.contractId }
        : undefined;
    return holdsPermission(effectivePermissions(access, now, scoped), permission);
  }
}
