/** The scope kinds of a grant (IAM section 3.4); the screen never sees another one. */
export const SCOPE_KINDS = ['TENANT', 'UNIT_SUBTREE', 'UNIT_ONLY', 'PROJECT', 'CONTRACT'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** Where a grant stands now: counted by the PDP, ended, or not started yet. */
export type GrantState = 'ACTIVE' | 'EXPIRED' | 'FUTURE';

export interface Crumb {
  id: string;
  code: string;
  name: string;
}

export interface ScopeUnit extends Crumb {
  path: string;
  /** From the root of the unit tree down to the unit itself. */
  breadcrumb: Crumb[];
}

export interface AccessGrant {
  id: string;
  roleCode: string;
  roleName: string;
  rank: number;
  scopeKind: ScopeKind;
  scopeRefIds: string[];
  units: ScopeUnit[];
  projects: Crumb[];
  contracts: Array<{ id: string; code: string }>;
  permissions: string[];
  effectiveFrom: string;
  effectiveUntil: string | null;
  state: GrantState;
}

export interface AccessDelegation {
  id: string;
  delegatorMembershipId: string;
  permissions: string[];
  scopeKind: string;
  validFrom: string;
  validUntil: string;
  state: 'ACTIVE' | 'FUTURE';
}

/** `EffectiveAccess` of the contract (getMyEffectiveAccess), read defensively: a field of another shape is left out, never trusted. */
export interface EffectiveAccessView {
  membershipId: string;
  scopeVersion: number;
  grants: AccessGrant[];
  delegations: AccessDelegation[];
  entitlementHash: string | undefined;
}

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw => (typeof value === 'object' && value !== null ? (value as Raw) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const texts = (value: unknown): string[] => list(value).filter((item): item is string => typeof item === 'string');

function toCrumb(raw: unknown): Crumb {
  const row = record(raw);
  return { id: text(row.id), code: text(row.code), name: text(row.name) };
}

function toScopeKind(value: unknown): ScopeKind {
  return (SCOPE_KINDS as readonly unknown[]).includes(value) ? (value as ScopeKind) : 'TENANT';
}

function toState(value: unknown): GrantState {
  return value === 'EXPIRED' || value === 'FUTURE' ? value : 'ACTIVE';
}

function toGrant(raw: unknown): AccessGrant {
  const row = record(raw);
  const scope = record(row.scope);
  return {
    id: text(row.id),
    roleCode: text(row.role_code),
    roleName: text(row.role_name),
    rank: typeof row.rank === 'number' ? row.rank : 0,
    scopeKind: toScopeKind(row.scope_kind),
    scopeRefIds: texts(row.scope_ref_ids),
    units: list(scope.units).map((unit) => ({ ...toCrumb(unit), path: text(record(unit).path), breadcrumb: list(record(unit).breadcrumb).map(toCrumb) })),
    projects: list(scope.projects).map(toCrumb),
    contracts: list(scope.contracts).map((contract) => ({ id: text(record(contract).id), code: text(record(contract).code) })),
    permissions: texts(row.permissions),
    effectiveFrom: text(row.effective_from),
    effectiveUntil: typeof row.effective_until === 'string' ? row.effective_until : null,
    state: toState(row.state),
  };
}

function toDelegation(raw: unknown): AccessDelegation {
  const row = record(raw);
  return {
    id: text(row.id),
    delegatorMembershipId: text(row.delegator_membership_id),
    permissions: texts(row.permissions),
    scopeKind: text(row.scope_kind),
    validFrom: text(row.valid_from),
    validUntil: text(row.valid_until),
    state: row.state === 'FUTURE' ? 'FUTURE' : 'ACTIVE',
  };
}

export function toEffectiveAccess(raw: unknown): EffectiveAccessView {
  const row = record(raw);
  return {
    membershipId: text(row.membership_id),
    scopeVersion: typeof row.scope_version === 'number' ? row.scope_version : 0,
    grants: list(row.grants).map(toGrant),
    delegations: list(row.delegations_in).map(toDelegation),
    entitlementHash: typeof row.entitlement_hash === 'string' ? row.entitlement_hash : undefined,
  };
}
