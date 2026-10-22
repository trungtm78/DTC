import { PERMISSIONS } from '@machvon/contracts';
import { DomainError, assertAllowedFields, asUuid } from '@machvon/kernel';
import type { AntiEscalationResult } from '@machvon/kernel';

export type GrantScopeKind = 'TENANT' | 'UNIT_SUBTREE' | 'UNIT_ONLY' | 'PROJECT' | 'CONTRACT';

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

const ROLE_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;
const PERMISSION_NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*(\.\*)?$/;
const SCOPE_KINDS: readonly GrantScopeKind[] = ['TENANT', 'UNIT_SUBTREE', 'UNIT_ONLY', 'PROJECT', 'CONTRACT'];
const MAX_PERMISSIONS = 200;
const MAX_SCOPE_REFS = 200;
const MAX_NAME = 120;
const MIN_REASON = 10;
const MAX_REASON = 2000;
const MAX_CUSTOM_RANK = 89;

// The permission names of openapi.json; a role may only hold names the API can ask for.
const CATALOGUE: readonly string[] = [...new Set(Object.values(PERMISSIONS))];

function invalid(field: string): DomainError {
  return new DomainError('INVALID_REQUEST', 400, field);
}

function record(body: unknown): Record<string, unknown> {
  return body as Record<string, unknown>;
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw invalid(field);
  return value;
}

function permissionList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PERMISSIONS || value.some((item) => typeof item !== 'string')) {
    throw invalid('permissions');
  }
  return value as string[];
}

function customRank(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_CUSTOM_RANK) throw invalid('rank');
  return value;
}

function uuid(value: unknown, field: string): string {
  const parsed = asUuid(value);
  if (parsed === undefined) throw invalid(field);
  return parsed;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(field);
  return new Date(value).toISOString();
}

/** Body of createCustomRole (RoleCreate): unknown fields are 400 FIELD_NOT_ALLOWED, bad values 400 INVALID_REQUEST. */
export function parseRoleCreate(body: unknown): RoleCreateDto {
  assertAllowedFields<RoleCreateDto & { guest_allowed: boolean }>(body, ['code', 'name', 'permissions', 'rank', 'guest_allowed']);
  const source = record(body);
  const code = text(source.code, 'code', 3, 41);
  if (!ROLE_CODE.test(code)) throw invalid('code');
  const guest = source.guest_allowed;
  if (guest !== undefined && typeof guest !== 'boolean') throw invalid('guest_allowed');
  return {
    code,
    name: text(source.name, 'name', 1, MAX_NAME),
    permissions: permissionList(source.permissions),
    rank: customRank(source.rank),
    guestAllowed: guest === true,
  };
}

/** Body of updateCustomRole (RoleUpdate). */
export function parseRoleUpdate(body: unknown): RoleUpdateDto {
  assertAllowedFields<RoleUpdateDto>(body, ['name', 'permissions', 'rank', 'reason']);
  const source = record(body);
  const update: RoleUpdateDto = { permissions: permissionList(source.permissions), reason: text(source.reason, 'reason', MIN_REASON, MAX_REASON) };
  if (source.name !== undefined) update.name = text(source.name, 'name', 1, MAX_NAME);
  if (source.rank !== undefined) update.rank = customRank(source.rank);
  return update;
}

/** Body of grantRole (RoleGrantCreate). */
export function parseGrantCreate(body: unknown): GrantCreateDto {
  assertAllowedFields<{
    membership_id: string;
    role_id: string;
    scope_kind: string;
    scope_ref_ids: string[];
    effective_from: string;
    effective_until: string;
    reason: string;
  }>(body, ['membership_id', 'role_id', 'scope_kind', 'scope_ref_ids', 'effective_from', 'effective_until', 'reason']);
  const source = record(body);
  const scopeKind = SCOPE_KINDS.find((kind) => kind === source.scope_kind);
  if (scopeKind === undefined) throw invalid('scope_kind');
  const refs = source.scope_ref_ids === undefined ? [] : source.scope_ref_ids;
  if (!Array.isArray(refs) || refs.length > MAX_SCOPE_REFS) throw invalid('scope_ref_ids');
  const scopeRefIds = refs.map((ref) => uuid(ref, 'scope_ref_ids'));
  if ((scopeKind === 'TENANT') !== (scopeRefIds.length === 0)) throw invalid('scope_ref_ids');
  const grant: GrantCreateDto = {
    membershipId: uuid(source.membership_id, 'membership_id'),
    roleId: uuid(source.role_id, 'role_id'),
    scopeKind,
    scopeRefIds,
    reason: text(source.reason, 'reason', MIN_REASON, MAX_REASON),
  };
  if (source.effective_from !== undefined) grant.effectiveFrom = timestamp(source.effective_from, 'effective_from');
  if (source.effective_until !== undefined) grant.effectiveUntil = timestamp(source.effective_until, 'effective_until');
  if (grant.effectiveUntil !== undefined && grant.effectiveFrom !== undefined && Date.parse(grant.effectiveUntil) <= Date.parse(grant.effectiveFrom)) {
    throw new DomainError('VALIDATION_FAILED', 422, 'effective_until');
  }
  return grant;
}

/** Body of revokeRoleGrant (ReasonOnly). */
export function parseReasonOnly(body: unknown): { reason: string } {
  assertAllowedFields<{ reason: string }>(body, ['reason']);
  return { reason: text(record(body).reason, 'reason', MIN_REASON, MAX_REASON) };
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
