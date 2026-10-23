import type { EffectiveAccess, GrantView } from './effective-access.ts';

export type ControlRole = 'SystemAdmin' | 'PlatformOperator' | 'BillingOperator' | 'SupportOperator';

/**
 * The permissions of the control-plane roles (SAS section 2). They come from realm roles in the token, never from
 * tenant grants. SystemAdmin holds every `system.*` permission through the pattern, so a permission added later is
 * covered without a code change; the other roles list exact names.
 */
export const CONTROL_ROLES: Readonly<Record<ControlRole, readonly string[]>> = {
  SystemAdmin: ['system.*'],
  PlatformOperator: ['system.tenant.read'],
  BillingOperator: ['system.billing.manage', 'system.tenant.read'],
  SupportOperator: ['system.support.request'],
};

// Control principals have no tenant memberships, so their grants carry fixed ranks (only used for ordering) and no
// time window: the realm role in the verified token is the whole authority.
const CONTROL_RANKS: Readonly<Record<ControlRole, number>> = {
  SystemAdmin: 99,
  BillingOperator: 60,
  PlatformOperator: 50,
  SupportOperator: 40,
};
const ALWAYS = new Date(0);

function isControlRole(role: string): role is ControlRole {
  return Object.hasOwn(CONTROL_ROLES, role);
}

/**
 * The effective access of a control-plane principal, built from the realm roles of its verified token: one tenant-wide
 * grant per known role (unknown and repeated roles are ignored). A principal with no known role gets an inactive access
 * that holds nothing. `scopeVersion` is 0: control access has no database-side version to compare with.
 */
export function controlAccessOf(roles: readonly string[], membershipId: string): EffectiveAccess {
  const known = [...new Set(roles.filter(isControlRole))].sort();
  const grants: GrantView[] = known.map((role) => ({
    roleCode: role,
    rank: CONTROL_RANKS[role],
    permissions: CONTROL_ROLES[role],
    scope: { kind: 'TENANT' },
    status: 'Active',
    effectiveFrom: ALWAYS,
    effectiveUntil: null,
  }));
  return { membershipId, scopeVersion: 0, membershipActive: grants.length > 0, grants };
}
