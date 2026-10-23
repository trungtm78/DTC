import { activeGrants, checkGrant, holdsPermission, maxRank } from '@machvon/kernel';
import type { EffectiveAccess, Scope } from '@machvon/kernel';

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
  /** `Retired` roles cannot be granted (grantRole answers 422), so the picker leaves them out. Absent means Active. */
  status?: string;
}

/**
 * The scopes a role could be granted on: every distinct scope of an active grant of the caller. The anti-escalation
 * check itself decides whether `iam.role.grant` covers the scope (a tenant-wide grant covers a unit scope) and which
 * permissions and rank the caller holds there (BR-IAM-05 sums every grant covering it), so a role the caller can only
 * hand out inside a narrower scope still shows up.
 */
function candidateScopes(access: EffectiveAccess, now: Date): Scope[] {
  const scopes = new Map<string, Scope>();
  for (const grant of activeGrants(access, now)) scopes.set(JSON.stringify(grant.scope), grant.scope);
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
  if (options.grantable && role.status !== undefined && role.status !== 'Active') return false;
  if (!options.grantable && managesTenantRoles(access, now)) return true;
  return candidateScopes(access, now).some(
    (requestedScope) => checkGrant({ grantor: access, recipientMembershipId: ANYONE_ELSE, role: { rank: role.rank, permissions: role.permissions }, requestedScope, now }).ok,
  );
}
