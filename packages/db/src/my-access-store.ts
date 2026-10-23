import type { GrantView } from '@machvon/kernel';
import { grantViewOf } from './effective-access-store.ts';
import type { GrantRow } from './effective-access-store.ts';
import type { TenantTx } from './tenant-database.ts';

/** One unit of a scope, with the units above it from the root (the breadcrumb IAM-09 shows under each scope). */
export interface ScopeUnit {
  id: string;
  code: string;
  name: string;
  path: string;
  breadcrumb: Array<{ id: string; code: string; name: string }>;
}

/** A grant of the member with what the screen needs to name its scope and role. */
export interface MyGrant {
  id: string;
  roleName: string;
  /** The grant as the PDP sees it: the effective permissions are computed from these, never from the DTO. */
  view: GrantView;
  scopeKind: GrantView['scope']['kind'];
  scopeRefIds: string[];
  /** `Expired` when the expiry job has already marked it; `Active` otherwise (its window may still have ended). */
  storedStatus: 'Active' | 'Expired';
  units: ScopeUnit[];
  projects: Array<{ id: string; code: string; name: string }>;
  contracts: Array<{ id: string; code: string }>;
}

/** A delegation the member received (ADM-04): what they may do in the name of someone else, and until when. */
export interface MyDelegation {
  id: string;
  delegatorMembershipId: string;
  permissions: string[];
  scopeKind: string;
  scopeRefIds: string[];
  validFrom: Date;
  validUntil: Date;
  status: 'Scheduled' | 'Active';
}

interface MyGrantRow extends GrantRow {
  id: string;
  role_name: string;
}

// Active grants and the ones the expiry job marked Expired; a revoked grant was taken away on purpose and is not shown.
// The unit paths are what the PDP needs, as in EffectiveAccessStore.
const GRANTS_SQL = `select g.id, r.code, r.name as role_name, r.rank, r.permissions, g.scope_kind, g.scope_ref_ids, g.status, g.effective_from, g.effective_until,
    coalesce((select array_agg(u.path order by u.path) from machvon.organization_unit u where u.id = any(g.scope_ref_ids)), '{}') as unit_paths
  from machvon.role_grant g
  join machvon.role_definition r on r.tenant_id = g.tenant_id and r.id = g.role_id
  where g.membership_id = $1::uuid and g.status in ('Active', 'Expired')
  order by g.created_at, g.id`;

// Units by id, with the link to their parent. A breadcrumb is built by asking for the parents level by level (a tree is at
// most eight deep), each level one primary-key lookup: a single recursive query made the planner scan the unit table.
const UNITS_SQL = `select id, code, name, path, parent_id from machvon.organization_unit where id = any($1::uuid[])`;

const DELEGATIONS_SQL = `select id, delegator_membership_id, permissions, scope_json, valid_from, valid_until, status
  from machvon.delegation_grant
  where delegate_membership_id = $1::uuid and status in ('Scheduled', 'Active') and valid_until > now()
  order by valid_from, id`;

interface UnitRow {
  id: string;
  code: string;
  name: string;
  path: string;
  parent_id: string | null;
}

interface DelegationRow {
  id: string;
  delegator_membership_id: string;
  permissions: string[];
  scope_json: { kind?: string; ref_ids?: string[] };
  valid_from: Date;
  valid_until: Date;
  status: 'Scheduled' | 'Active';
}

/**
 * The access of one member as IAM-09 shows it (getMyEffectiveAccess): their own grants with the units, projects and
 * contracts their scopes name, and the delegations they received. Every query is keyed by the membership the caller
 * passes, which the API takes from the verified token and nowhere else, and runs under row-level security.
 */
export class MyAccessStore {
  /** The database `scope_version` of the membership: the value the screen compares with to notice that its access changed. */
  async scopeVersionOf(tx: TenantTx, membershipId: string): Promise<number> {
    const rows = await tx.query<{ scope_version: string }>('select scope_version::text as scope_version from machvon.membership where id = $1::uuid', [membershipId]);
    return Number(rows[0]?.scope_version ?? 0);
  }

  async grants(tx: TenantTx, membershipId: string): Promise<MyGrant[]> {
    const rows = await tx.query<MyGrantRow>(GRANTS_SQL, [membershipId]);
    const refs = (kind: string): string[] => [...new Set(rows.filter((row) => row.scope_kind === kind).flatMap((row) => row.scope_ref_ids))];
    const unitIds = [...new Set([...refs('UNIT_SUBTREE'), ...refs('UNIT_ONLY')])];
    const units = await this.unitsOf(tx, unitIds);
    const projects = await this.projectsOf(tx, refs('PROJECT'));
    const contracts = await this.contractsOf(tx, refs('CONTRACT'));
    const named = <T>(found: Map<string, T>, ids: readonly string[]): T[] => ids.flatMap((ref) => found.get(ref) ?? []);
    return rows.map((row) => ({
      id: row.id,
      roleName: row.role_name,
      view: grantViewOf(row),
      scopeKind: row.scope_kind,
      scopeRefIds: row.scope_ref_ids,
      storedStatus: row.status === 'Expired' ? 'Expired' : 'Active',
      units: named(units, row.scope_ref_ids),
      projects: named(projects, row.scope_ref_ids),
      contracts: named(contracts, row.scope_ref_ids),
    }));
  }

  async delegationsTo(tx: TenantTx, membershipId: string): Promise<MyDelegation[]> {
    const rows = await tx.query<DelegationRow>(DELEGATIONS_SQL, [membershipId]);
    return rows.map((row) => ({
      id: row.id,
      delegatorMembershipId: row.delegator_membership_id,
      permissions: row.permissions,
      scopeKind: row.scope_json.kind ?? 'TENANT',
      scopeRefIds: row.scope_json.ref_ids ?? [],
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      status: row.status,
    }));
  }

  private async unitsOf(tx: TenantTx, unitIds: string[]): Promise<Map<string, ScopeUnit>> {
    const known = new Map<string, UnitRow>();
    for (let wanted = unitIds; wanted.length > 0; ) {
      const rows = await tx.query<UnitRow>(UNITS_SQL, [wanted]);
      for (const row of rows) known.set(row.id, row);
      wanted = [...new Set(rows.flatMap((row) => (row.parent_id === null || known.has(row.parent_id) ? [] : [row.parent_id])))];
    }
    const found = new Map<string, ScopeUnit>();
    for (const id of unitIds) {
      const unit = known.get(id);
      if (unit === undefined) continue;
      // From the unit up to the root by parent links, then reversed: the breadcrumb reads from the root down to the unit.
      const chain: UnitRow[] = [];
      for (let cursor: UnitRow | undefined = unit; cursor !== undefined && !chain.includes(cursor); cursor = cursor.parent_id === null ? undefined : known.get(cursor.parent_id)) chain.push(cursor);
      found.set(id, { id, code: unit.code, name: unit.name, path: unit.path, breadcrumb: chain.reverse().map(({ id: unitId, code, name }) => ({ id: unitId, code, name })) });
    }
    return found;
  }

  private async projectsOf(tx: TenantTx, projectIds: string[]): Promise<Map<string, { id: string; code: string; name: string }>> {
    if (projectIds.length === 0) return new Map();
    const rows = await tx.query<{ id: string; code: string; name: string }>('select id, code, name from machvon.project where id = any($1::uuid[])', [projectIds]);
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async contractsOf(tx: TenantTx, contractIds: string[]): Promise<Map<string, { id: string; code: string }>> {
    if (contractIds.length === 0) return new Map();
    const rows = await tx.query<{ id: string; code: string }>('select id, code from machvon.contract where id = any($1::uuid[])', [contractIds]);
    return new Map(rows.map((row) => [row.id, row]));
  }
}
