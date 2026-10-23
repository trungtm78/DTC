import { activeGrants, holdsPermission } from '@machvon/kernel';
import type { EffectiveAccess } from '@machvon/kernel';

/**
 * Whether the caller holds the permission through a grant on the whole tenant. Tenant administration data (legal
 * holds, the identity behind an impersonation) is not owned by one organisation unit, so a grant on a subtree does not
 * reach it.
 */
export function holdsOnWholeTenant(access: EffectiveAccess, permission: string): boolean {
  return activeGrants(access, new Date()).some((grant) => grant.scope.kind === 'TENANT' && holdsPermission(new Set(grant.permissions), permission));
}
