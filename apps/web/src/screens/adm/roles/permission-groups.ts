import { PERMISSIONS, PLANES } from '@machvon/contracts';

const SYSTEM_PREFIX = 'system.';
const WILDCARD = '*';
const SELF_ACTION = 'self';

export interface PermissionGroup {
  /** The permission name without its last segment (`iam.role`); a bare name is its own resource. */
  resource: string;
  /** The last segments of the permissions under the resource; `*` (a pattern) comes first. */
  actions: string[];
}

function isSystem(permission: string): boolean {
  return permission.startsWith(SYSTEM_PREFIX) || permission === 'system';
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareActions(a: string, b: string): number {
  if (a === WILDCARD) return b === WILDCARD ? 0 : -1;
  if (b === WILDCARD) return 1;
  return compare(a, b);
}

/**
 * Groups permission names into the resource x action matrix of the role editor. `a.b.c` is action `c` of resource
 * `a.b`, a pattern `a.*` is action `*` of resource `a`, and a name without a dot is the action `self` of itself.
 * System permissions are never listed: a tenant can neither hold nor hand them out.
 */
export function groupPermissions(permissions: readonly string[]): PermissionGroup[] {
  const byResource = new Map<string, Set<string>>();
  for (const permission of permissions) {
    if (isSystem(permission)) continue;
    const cut = permission.lastIndexOf('.');
    const resource = cut < 0 ? permission : permission.slice(0, cut);
    const action = cut < 0 ? SELF_ACTION : permission.slice(cut + 1);
    const actions = byResource.get(resource) ?? new Set<string>();
    actions.add(action);
    byResource.set(resource, actions);
  }
  return [...byResource.keys()]
    .sort(compare)
    .map((resource) => ({ resource, actions: [...(byResource.get(resource) ?? [])].sort(compareActions) }));
}

/** The inverse of the grouping: the permission name of a resource and an action. */
export function permissionOf(resource: string, action: string): string {
  return action === SELF_ACTION && !resource.includes('.') ? resource : `${resource}.${action}`;
}

/** Adds the permission when it is missing and removes it when present; the result is sorted and unique. */
export function togglePermission(permissions: readonly string[], permission: string): string[] {
  const next = new Set(permissions);
  if (!next.delete(permission)) next.add(permission);
  return [...next].sort(compare);
}

/**
 * Every permission a tenant role may carry: the tenant-plane permissions of the contract, without system ones.
 * The server still refuses what the signed-in user may not hand out (ROLE_ESCALATION_DENIED).
 */
export function assignablePermissions(): string[] {
  const names = new Set<string>();
  for (const [operation, permission] of Object.entries(PERMISSIONS)) {
    if (PLANES[operation as keyof typeof PLANES] !== 'tenant' || isSystem(permission)) continue;
    names.add(permission);
  }
  return [...names].sort(compare);
}
