import { activeGrants, permissionMatches } from '@machvon/kernel';
import type { EffectiveAccess } from '@machvon/kernel';
import type { TenantTx } from './tenant-database.ts';

const PLAIN_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/** Raises `scope_version` by one for each listed membership, in a single statement of the caller's transaction. */
export async function bumpScopeVersion(tx: TenantTx, membershipIds: readonly string[]): Promise<void> {
  const unique = [...new Set(membershipIds)];
  if (unique.length === 0) return;
  await tx.query('update machvon.membership set scope_version = scope_version + 1 where id = any($1::uuid[])', [unique]);
}

// A subtree grant is affected when its root and a changed unit lie on one branch (either is a path prefix of the other,
// compared on whole segments because stored paths end with a slash); a UNIT_ONLY grant only when it sits on a changed unit.
const AFFECTED_SQL = `select distinct g.membership_id
  from machvon.role_grant g
  where g.status = 'Active'
    and (
      (g.scope_kind = 'UNIT_ONLY' and g.scope_ref_ids && $1::uuid[])
      or (g.scope_kind = 'UNIT_SUBTREE' and exists (
        select 1
        from machvon.organization_unit root
        join machvon.organization_unit changed on changed.id = any($1::uuid[])
        where root.id = any(g.scope_ref_ids)
          and (starts_with(changed.path, root.path) or starts_with(root.path, changed.path))
      ))
    )
  order by g.membership_id`;

/** Memberships whose effective access can change when the given units change or move; sorted, without duplicates. */
export async function membershipsAffectedByUnits(tx: TenantTx, unitIds: readonly string[]): Promise<string[]> {
  const unique = [...new Set(unitIds)];
  if (unique.length === 0) return [];
  const rows = await tx.query<{ membership_id: string }>(AFFECTED_SQL, [unique]);
  return rows.map((row) => row.membership_id);
}

export interface UnitColumns {
  /** Column holding the owner unit path, for example `u.path`; a plain identifier, never user input. */
  unitPath: string;
  /** Column holding the owner unit id. */
  unitId: string;
}

export interface ScopePredicate {
  sql: string;
  params: unknown[];
}

/** Compiles the scope of a caller into a predicate whose parameters are numbered from `firstParam`. */
export type ScopeBuilder = (firstParam: number) => ScopePredicate;

function assertColumn(column: string): void {
  if (!PLAIN_COLUMN.test(column)) throw new Error('scope predicate column must be a plain identifier');
}

/**
 * Compiles the scopes of the grants that carry `permission` into a SQL predicate over the owner unit of a resource,
 * so list reads filter before pagination. Whole path segments only: the column is closed with a slash and tested with
 * starts_with against closed grant paths. All values are parameters, numbered from `firstParam`. A TENANT grant gives
 * `true`; no usable grant gives `false`. PROJECT and CONTRACT scopes cannot be judged from a unit column and add nothing.
 */
export function scopePredicate(
  access: EffectiveAccess,
  permission: string,
  now: Date,
  columns: UnitColumns,
  firstParam = 1,
): ScopePredicate {
  assertColumn(columns.unitPath);
  assertColumn(columns.unitId);
  const params: unknown[] = [];
  const alternatives: string[] = [];
  const next = (value: unknown): string => {
    params.push(value);
    return `$${firstParam + params.length - 1}`;
  };
  const paths = new Set<string>();
  const unitIds = new Set<string>();
  for (const grant of activeGrants(access, now)) {
    if (!grant.permissions.some((held) => permissionMatches(held, permission))) continue;
    if (grant.scope.kind === 'TENANT') return { sql: 'true', params: [] };
    if (grant.scope.kind === 'UNIT_SUBTREE') for (const path of grant.scope.paths ?? []) paths.add(path.endsWith('/') ? path : `${path}/`);
    if (grant.scope.kind === 'UNIT_ONLY') for (const id of grant.scope.refIds) unitIds.add(id);
  }
  for (const path of [...paths].sort()) alternatives.push(`starts_with(rtrim(${columns.unitPath}, '/') || '/', ${next(path)})`);
  if (unitIds.size > 0) alternatives.push(`${columns.unitId} = any(${next([...unitIds].sort())}::uuid[])`);
  if (alternatives.length === 0) return { sql: 'false', params: [] };
  return { sql: `(${alternatives.join(' or ')})`, params };
}
