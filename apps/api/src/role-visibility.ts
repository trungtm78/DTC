import { activeGrants, checkGrant, holdsPermission, maxRank } from '@machvon/kernel';
import type { EffectiveAccess, Scope } from '@machvon/kernel';

const GRANT_PERMISSION = 'iam.role.grant';
const MANAGE_PERMISSION = 'iam.role.manage';
const TENANT_OWNER = 'TENANT_OWNER';
const TENANT_OWNER_RANK = 99;
const TENANT_SCOPE: Scope = { kind: 'TENANT' };
// checkGrant refuses a grant to oneself; the picker asks about roles in general, so it names someone else.
const ANYONE_ELSE = '00000000-0000-4000-8000-000000000000';

export interface VisibleRole {
  code: string;
  rank: number;
  permissions: readonly string[];
}

/** The scopes on which the caller may grant roles: one per distinct active grant that carries `iam.role.grant`. */
function grantScopes(access: EffectiveAccess, now: Date): Scope[] {
  const scopes = new Map<string, Scope>();
  for (const grant of activeGrants(access, now)) {
    if (!holdsPermission(new Set(grant.permissions), GRANT_PERMISSION)) continue;
    scopes.set(JSON.stringify(grant.scope), grant.scope);
  }
  return [...scopes.values()];
}

function managesTenantRoles(access: EffectiveAccess, now: Date): boolean {
  return activeGrants(access, now).some((grant) => grant.scope.kind === 'TENANT' && holdsPermission(new Set(grant.permissions), MANAGE_PERMISSION));
}

/**
 * Whether the caller may see a role definition (ADM-03, CR-ADM-05). Tenant-wide `iam.role.manage` shows every role
 * (TENANT_OWNER only to someone of owner rank); otherwise, and always when `grantable` is set, only the roles
 * the caller could grant on one of their scopes: the same anti-escalation check `grantRole` applies, so the role
 * picker never lists a role the server would refuse.
 */
export function roleVisibleTo(access: EffectiveAccess, role: VisibleRole, options: { grantable: boolean; now: Date }): boolean {
  const { now } = options;
  if (role.code === TENANT_OWNER && maxRank(access, now, TENANT_SCOPE) < TENANT_OWNER_RANK) return false;
  if (!options.grantable && managesTenantRoles(access, now)) return true;
  return grantScopes(access, now).some(
    (requestedScope) => checkGrant({ grantor: access, recipientMembershipId: ANYONE_ELSE, role: { rank: role.rank, permissions: role.permissions }, requestedScope, now }).ok,
  );
}
