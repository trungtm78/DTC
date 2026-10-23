import { activeGrants, holdsPermission, scopeContains } from '@machvon/kernel';
import type { EffectiveAccess } from '@machvon/kernel';

/** Whether a grant that carries `permission` has a scope that contains the organisation unit. */
export function mayActOnUnit(access: EffectiveAccess, permission: string, unit: { id: string; path: string }, now: Date): boolean {
  return activeGrants(access, now).some(
    (grant) => holdsPermission(new Set(grant.permissions), permission) && scopeContains(grant.scope, { ownerUnitId: unit.id, ownerUnitPath: unit.path }),
  );
}
