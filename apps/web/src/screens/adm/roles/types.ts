/** RoleDefinitionView of openapi.json. `name` is display text for a custom role and an i18n key for a system role. */
export interface RoleView {
  id: string;
  code: string;
  name: string;
  rank: number;
  permissions: string[];
  is_system: boolean;
  guest_allowed: boolean;
  status: 'Active' | 'Retired';
  version: number;
}

export const SCOPE_KINDS = ['TENANT', 'UNIT_SUBTREE', 'UNIT_ONLY', 'PROJECT', 'CONTRACT'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** A grant as the API lists it (get_resources_role_grant). */
export interface GrantView {
  id: string;
  membership_id: string;
  role_id: string;
  role_code: string;
  scope_kind: ScopeKind;
  scope_ref_ids: string[];
  status: 'Active' | 'Revoked' | 'Expired';
  effective_from: string;
  effective_until: string | null;
  granted_by: string;
  grant_reason: string;
  version: number;
}

/** The permissions that decide what the screen offers; the server still decides every request. */
export const PERMISSION_READ = 'role_grant.read';
export const PERMISSION_GRANT = 'iam.role.grant';
export const PERMISSION_MANAGE = 'iam.role.manage';

/** The least a reason must have (ReasonOnly, RoleUpdate, RoleGrantCreate in openapi.json). */
export const MIN_REASON_LENGTH = 10;
export const MAX_RANK = 89;
