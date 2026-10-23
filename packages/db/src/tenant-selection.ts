import type { TenantTx } from './tenant-database.ts';

/** Roles that must sign in with a second factor when the tenant has published no security policy (IAM BR-IAM-11). */
export const DEFAULT_MFA_REQUIRED_ROLES: readonly string[] = ['LEADER', 'SECURITY_ADMIN', 'TENANT_ADMIN', 'TENANT_OWNER'];

/** What a tenant selection needs to know about a membership, read inside the tenant transaction with the row locked. */
export interface SelectionFacts {
  userAccountId: string;
  status: string;
  /** Whether the database clock is inside `[valid_from, valid_until)`. */
  insideValidity: boolean;
  scopeVersion: number;
  /** Codes of the roles of the membership's active grants. */
  roleCodes: readonly string[];
  /** Roles that need aal2 in this tenant: the published security policy, or the default list. */
  mfaRequiredRoles: readonly string[];
}

const MEMBERSHIP_SQL = `select user_id, status, scope_version::int as scope_version,
    (now() >= valid_from and (valid_until is null or now() < valid_until)) as inside_validity
  from machvon.membership where id = $1::uuid for update`;

// Grants whose window has not started or has ended grant nothing (BR-IAM-03), so they never make MFA mandatory.
const ROLES_SQL = `select distinct r.code
  from machvon.role_grant g
  join machvon.role_definition r on r.tenant_id = g.tenant_id and r.id = g.role_id
  where g.membership_id = $1::uuid and g.status = 'Active'
    and g.effective_from <= now() and (g.effective_until is null or g.effective_until > now())
  order by r.code`;

const POLICY_SQL = `select policy_json -> 'mfa_required_roles' as roles
  from machvon.security_policy_version where status = 'Published' order by revision desc limit 1`;

function rolesOf(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((role) => typeof role === 'string') ? (value as string[]) : undefined;
}

/**
 * Reads the membership of the caller's transaction for a tenant selection and locks its row, so two selections of
 * one membership serialise. Returns undefined for a membership that is not in the tenant of the transaction.
 */
export async function loadSelectionFacts(tx: TenantTx, membershipId: string): Promise<SelectionFacts | undefined> {
  const [membership] = await tx.query<{ user_id: string; status: string; scope_version: number; inside_validity: boolean }>(MEMBERSHIP_SQL, [membershipId]);
  if (membership === undefined) return undefined;
  const roles = await tx.query<{ code: string }>(ROLES_SQL, [membershipId]);
  const [policy] = await tx.query<{ roles: unknown }>(POLICY_SQL);
  return {
    userAccountId: membership.user_id,
    status: membership.status,
    insideValidity: membership.inside_validity,
    scopeVersion: membership.scope_version,
    roleCodes: roles.map((row) => row.code),
    mfaRequiredRoles: rolesOf(policy?.roles) ?? DEFAULT_MFA_REQUIRED_ROLES,
  };
}
