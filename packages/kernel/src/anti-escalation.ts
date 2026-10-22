import { activeGrants } from './effective-access.ts';
import type { EffectiveAccess } from './effective-access.ts';
import { holdsPermission } from './effective-access.ts';
import { scopeCovers } from './scope.ts';
import type { Scope } from './scope.ts';

const GRANT_PERMISSION = 'iam.role.grant';
const ROLE_MANAGE_PERMISSION = 'iam.role.manage';
const SYSTEM_PREFIX = 'system.';

export type AntiEscalationCode = 'SCOPE_OUT_OF_GRANTOR_RANGE' | 'ROLE_ESCALATION_DENIED' | 'SELF_GRANT_DENIED' | 'SYSTEM_PERMISSION_NOT_GRANTABLE';

export type AntiEscalationResult = { ok: true } | { ok: false; code: AntiEscalationCode; status: 403 | 422 };

export interface GrantCheckInput {
  grantor: EffectiveAccess;
  recipientMembershipId: string;
  role: { rank: number; permissions: readonly string[] };
  requestedScope: Scope;
  now: Date;
}

export interface RoleDefinitionCheckInput {
  grantor: EffectiveAccess;
  permissions: readonly string[];
  rank: number;
  /** Scope the role definition is managed in; the tenant scope for a tenant-wide custom role. */
  scope: Scope;
  now: Date;
}

const deny = (code: AntiEscalationCode, status: 403 | 422): AntiEscalationResult => ({ ok: false, code, status });

/**
 * Whether the held permissions cover `wanted`, which is an exact name or a `prefix.*` pattern. A pattern is covered
 * only by an equal or broader pattern, never by the exact names below it: holding `iam.unit.manage` does not allow
 * handing out `iam.*`. A bare `*` and an empty string are never covered.
 */
export function permissionCovered(held: Iterable<string>, wanted: string): boolean {
  return holdsPermission(new Set(held), wanted);
}

function isSystemPermission(permission: string): boolean {
  return permission.startsWith(SYSTEM_PREFIX);
}

// Rules (e), (a), (b), (c) of BR-IAM-05 in this order; `managePermission` is what the actor needs on the scope.
function checkRole(
  actor: EffectiveAccess,
  role: { rank: number; permissions: readonly string[] },
  scope: Scope,
  managePermission: string,
  now: Date,
): AntiEscalationResult {
  if (role.permissions.some(isSystemPermission)) return deny('SYSTEM_PERMISSION_NOT_GRANTABLE', 422);

  const covering = activeGrants(actor, now).filter((grant) => scopeCovers(grant.scope, scope));
  const mayManage = covering.some((grant) => grant.permissions.some((permission) => holdsPermission(new Set([permission]), managePermission)));
  if (!mayManage) return deny('SCOPE_OUT_OF_GRANTOR_RANGE', 403);

  const highestRank = covering.reduce((highest, grant) => Math.max(highest, grant.rank), 0);
  if (role.rank >= highestRank) return deny('ROLE_ESCALATION_DENIED', 403);

  const held = new Set(covering.flatMap((grant) => grant.permissions));
  if (!role.permissions.every((permission) => holdsPermission(held, permission))) return deny('ROLE_ESCALATION_DENIED', 403);
  return { ok: true };
}

/**
 * Anti-escalation for `grantRole` (BR-IAM-05): (d) the recipient is not the grantor, (e) the role has no `system.*`
 * permission, (a) the grantor holds `iam.role.grant` on a scope covering the requested one, (b) the role ranks strictly
 * below the grantor's highest rank there, (c) every role permission is held by the grantor there.
 */
export function checkGrant(input: GrantCheckInput): AntiEscalationResult {
  if (input.recipientMembershipId === input.grantor.membershipId) return deny('SELF_GRANT_DENIED', 403);
  return checkRole(input.grantor, input.role, input.requestedScope, GRANT_PERMISSION, input.now);
}

/** The same rules (without the recipient) for creating or changing a custom role, which needs `iam.role.manage`. */
export function checkRoleDefinition(input: RoleDefinitionCheckInput): AntiEscalationResult {
  return checkRole(input.grantor, { rank: input.rank, permissions: input.permissions }, input.scope, ROLE_MANAGE_PERMISSION, input.now);
}
