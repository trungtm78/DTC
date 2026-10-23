import { PERMISSIONS } from '@machvon/contracts';
import { DomainError, asUuid } from '@machvon/kernel';
import type { AntiEscalationResult } from '@machvon/kernel';
import type { Schemas } from './contract-types';

// The bodies below have already been checked against their schemas in openapi.json by the command pipeline
// (generated validation), so these mappers only rename fields and apply the rules a schema cannot express.

export type GrantScopeKind = Schemas['RoleGrantCreate']['scope_kind'];

export interface RoleCreateDto {
  code: string;
  name: string;
  permissions: string[];
  rank: number;
  guestAllowed: boolean;
}

export interface RoleUpdateDto {
  name?: string;
  permissions: string[];
  rank?: number;
  reason: string;
}

export interface GrantCreateDto {
  membershipId: string;
  roleId: string;
  scopeKind: GrantScopeKind;
  scopeRefIds: string[];
  effectiveFrom?: string;
  effectiveUntil?: string;
  reason: string;
}

const PERMISSION_NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*(\.\*)?$/;

// The permission names of openapi.json; a role may only hold names the API can ask for.
const CATALOGUE: readonly string[] = [...new Set(Object.values(PERMISSIONS))];

function invalid(field: string): DomainError {
  return new DomainError('INVALID_REQUEST', 400, field);
}

// The schema leaves the name length open from below; an empty name is still not a name.
function roleName(value: string): string {
  if (value.length < 1) throw invalid('name');
  return value;
}

/** createCustomRole (RoleCreate). */
export function roleCreateOf(body: Schemas['RoleCreate']): RoleCreateDto {
  return {
    code: body.code,
    name: roleName(body.name),
    permissions: body.permissions,
    rank: body.rank,
    guestAllowed: body.guest_allowed === true,
  };
}

/** updateCustomRole (RoleUpdate). */
export function roleUpdateOf(body: Schemas['RoleUpdate']): RoleUpdateDto {
  const update: RoleUpdateDto = { permissions: body.permissions, reason: body.reason };
  if (body.name !== undefined) update.name = roleName(body.name);
  if (body.rank !== undefined) update.rank = body.rank;
  return update;
}

function timestamp(value: string): string {
  return new Date(value).toISOString();
}

/** grantRole (RoleGrantCreate): ids lower-cased, times normalised, and the cross-field rules of a grant window and scope. */
export function grantCreateOf(body: Schemas['RoleGrantCreate'], now: number = Date.now()): GrantCreateDto {
  const scopeRefIds = (body.scope_ref_ids ?? []).map((ref) => asUuid(ref) ?? ref);
  if ((body.scope_kind === 'TENANT') !== (scopeRefIds.length === 0)) throw invalid('scope_ref_ids');
  const grant: GrantCreateDto = {
    membershipId: asUuid(body.membership_id) ?? body.membership_id,
    roleId: asUuid(body.role_id) ?? body.role_id,
    scopeKind: body.scope_kind,
    scopeRefIds,
    reason: body.reason,
  };
  if (body.effective_from !== undefined) grant.effectiveFrom = timestamp(body.effective_from);
  if (body.effective_until !== undefined) grant.effectiveUntil = timestamp(body.effective_until);
  if (grant.effectiveUntil !== undefined && grant.effectiveFrom !== undefined && Date.parse(grant.effectiveUntil) <= Date.parse(grant.effectiveFrom)) {
    throw new DomainError('VALIDATION_FAILED', 422, 'effective_until');
  }
  // Without a start the grant starts now, so an end that has already passed is an impossible window.
  if (grant.effectiveUntil !== undefined && grant.effectiveFrom === undefined && Date.parse(grant.effectiveUntil) <= now) {
    throw new DomainError('VALIDATION_FAILED', 422, 'effective_until');
  }
  return grant;
}

/**
 * Every permission of a role must be a name from the catalogue of openapi.json, or a `prefix.*` pattern that
 * matches at least one of them; duplicates are refused. Anything else is 422 VALIDATION_FAILED.
 */
export function assertKnownPermissions(permissions: readonly string[]): void {
  const seen = new Set<string>();
  for (const permission of permissions) {
    if (!PERMISSION_NAME.test(permission) || seen.has(permission)) throw new DomainError('VALIDATION_FAILED', 422, 'permissions');
    seen.add(permission);
    const known = permission.endsWith('.*')
      ? CATALOGUE.some((name) => name.startsWith(permission.slice(0, -1)))
      : CATALOGUE.includes(permission);
    if (!known) throw new DomainError('VALIDATION_FAILED', 422, 'permissions');
  }
}

/** Turns a refused anti-escalation verdict into the DomainError the API answers with. */
export function assertVerdict(verdict: AntiEscalationResult): void {
  if (!verdict.ok) throw new DomainError(verdict.code, verdict.status);
}
