import { Client } from 'pg';
import { id, unitId } from './authz-fixtures';

/** The size of the load the scope queries are measured against (IAM section 3.4: a tenant of thousands of units). */
export const LOAD_UNITS = 5_000;
export const LOAD_GRANTS_PER_MEMBER = 10;
export const LOAD_FAN_OUT = 6;

export const loadMemberId = (n: number): string => id(0x22, n);
const loadUserId = (n: number): string => id(0x62, n);

/** Unit n of the load tree: unit 1 is the root and every unit has up to six children. */
export const loadParentOf = (n: number): number | undefined => (n === 1 ? undefined : Math.floor((n - 2) / LOAD_FAN_OUT) + 1);

/** The path of every unit of the tree: parent path, then the id of the unit, closed with a slash (as `createUnit` writes it). */
export function loadPaths(units = LOAD_UNITS): string[] {
  const paths: string[] = [];
  for (let n = 1; n <= units; n += 1) {
    const parent = loadParentOf(n);
    paths.push(`${parent === undefined ? '/' : (paths[parent - 1] ?? '/')}${unitId(n)}/`);
  }
  return paths;
}

export interface LoadSeeded {
  units: number;
  members: number;
  grants: number;
}

/**
 * Seeds one tenant with 5,000 units in a tree of depth five, one member per unit and ten grants per member (50,000), with
 * grants of every kind and window: mostly Active ones inside their window, then some that ended and some that have not
 * started. Rows are written in bulk (`unnest`), as machvon_owner with the tenant set, so row-level security still applies.
 * Roles must already exist (`seedSystemRoles`).
 */
export async function seedScopeLoad(ownerUrl: string, tenantId: string, grantedBy: string, units = LOAD_UNITS): Promise<LoadSeeded> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const numbers = Array.from({ length: units }, (_, index) => index + 1);
    const paths = loadPaths(units);
    await client.query(
      `insert into machvon.organization_unit (tenant_id, id, code, name, parent_id, valid_from, path, depth)
       select $1, u.id, 'L' || u.n, 'Load unit ' || u.n, u.parent, date '2026-01-01', u.path, u.depth
         from unnest($2::uuid[], $3::int[], $4::uuid[], $5::text[], $6::int[]) as u(id, n, parent, path, depth)`,
      [
        tenantId,
        numbers.map(unitId),
        numbers,
        numbers.map((n) => {
          const parent = loadParentOf(n);
          return parent === undefined ? null : unitId(parent);
        }),
        paths,
        paths.map((path) => path.split('/').length - 3),
      ],
    );
    await client.query(
      `insert into machvon.user_account (id, idp_subject, email_normalized, display_name, status)
       select u.id, 'load-sub-' || u.n, 'load' || u.n || '@example.test', 'Load user ' || u.n, 'Active'
         from unnest($1::uuid[], $2::int[]) as u(id, n)`,
      [numbers.map(loadUserId), numbers],
    );
    await client.query(
      `insert into machvon.membership (tenant_id, id, user_id, organization_id, status, valid_from)
       select $1, m.id, m.user_id, m.unit_id, 'Active', now() - interval '1 day'
         from unnest($2::uuid[], $3::uuid[], $4::uuid[]) as m(id, user_id, unit_id)`,
      [tenantId, numbers.map(loadMemberId), numbers.map(loadUserId), numbers.map(unitId)],
    );

    // Ten grants for member i: role k mod roles, scope on unit ((i * 7 + k * 131) mod units) + 1, so no two Active grants of one member are equal.
    // k = 0 is a subtree on the member's own unit; k = 8 ended yesterday; k = 9 starts tomorrow; k mod 3 = 2 is UNIT_ONLY.
    const inserted = await client.query(
      `with roles as (
         select array_agg(id order by code) as ids from machvon.role_definition where tenant_id = $1
       ), spec as (
         select m.n, k.k,
                case when k.k = 0 then m.n else ((m.n * 7 + k.k * 131) % $2) + 1 end as unit_n,
                (m.n - 1) * $3 + k.k + 1 as grant_n
           from generate_series(1, $2) as m(n) cross join generate_series(0, $3 - 1) as k(k)
       )
       insert into machvon.role_grant
         (tenant_id, id, membership_id, role_id, scope_json, effective_from, effective_until, scope_kind, scope_ref_ids, status, granted_by, grant_reason)
       select $1,
              ('00000000-0000-4000-0042-' || lpad(to_hex(s.grant_n), 12, '0'))::uuid,
              ('00000000-0000-4000-0022-' || lpad(to_hex(s.n), 12, '0'))::uuid,
              roles.ids[(s.k % cardinality(roles.ids)) + 1],
              jsonb_build_object('kind', case when s.k % 3 = 2 then 'UNIT_ONLY' else 'UNIT_SUBTREE' end),
              case when s.k = 9 then now() + interval '1 day' else timestamptz '2026-01-01T00:00:00Z' end,
              case when s.k = 8 then now() - interval '1 day' when s.k = 9 then now() + interval '30 days' end,
              case when s.k % 3 = 2 then 'UNIT_ONLY' else 'UNIT_SUBTREE' end,
              array[('00000000-0000-4000-0010-' || lpad(to_hex(s.unit_n), 12, '0'))::uuid],
              'Active', $4::uuid, 'load'
         from spec s cross join roles`,
      [tenantId, units, LOAD_GRANTS_PER_MEMBER, grantedBy],
    );
    await client.query('commit');
    return { units, members: units, grants: inserted.rowCount ?? 0 };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
