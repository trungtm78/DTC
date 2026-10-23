import { PERMISSIONS } from '@machvon/contracts';
import type { SystemRole } from '@machvon/db';
import { holdsPermission } from '@machvon/kernel';

/** Ids in tenant A that the command fixtures act on; the test seeds them. */
export interface MatrixTargets {
  unit2: string;
  unit3: string;
  customRoleId: string;
  /** The seeded system role MEMBER (lowest rank, so every real grantor could grant it). */
  memberRoleId: string;
  recipientMembershipId: string;
  grantToRevoke: string;
  /** A notification of RECIPIENT: the notification commands name it in the path. */
  notificationId: string;
  /** An Active tenant-wide legal hold of tenant A. */
  legalHoldId: string;
}

export interface MatrixRequest {
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
  ifMatch?: string;
}

export interface CommandFixture {
  /** A request that would succeed (and change state) if the guard let it through. */
  build(targets: MatrixTargets): MatrixRequest;
  /**
   * The request names ids of tenant A. A caller of another tenant must then get 403 or 404; a command that names no
   * foreign id (createCustomRole) legitimately works inside the caller's own tenant, so only tenant A must stay untouched.
   */
  referencesTenantIds: boolean;
}

const REASON = 'negative authorization matrix';

/**
 * One fixture per implemented command. The list of keys is mirrored in matrix-commands.json, which
 * `npm run commands:check` compares with the commands found in the source, so a new command cannot ship
 * without a row here.
 */
export const COMMAND_FIXTURES: Readonly<Record<string, CommandFixture>> = {
  createOrganizationUnit: {
    referencesTenantIds: true,
    build: (t) => ({
      method: 'POST',
      path: '/org-units',
      body: { code: 'MATRIX-NEW', name: 'Matrix unit', parent_id: t.unit2, unit_type: 'DEPARTMENT', valid_from: '2026-01-01' },
    }),
  },
  updateOrganizationUnit: {
    referencesTenantIds: true,
    build: (t) => ({ method: 'PUT', path: `/org-units/${t.unit3}`, ifMatch: '"1"', body: { name: 'Renamed by matrix' } }),
  },
  moveOrganizationUnit: {
    referencesTenantIds: true,
    build: (t) => ({
      method: 'POST',
      path: `/org-units/${t.unit3}/move`,
      ifMatch: '"1"',
      body: { new_parent_id: t.unit2, effective_from: '2026-01-01', reason: REASON },
    }),
  },
  createCustomRole: {
    referencesTenantIds: false,
    build: () => ({
      method: 'POST',
      path: '/roles',
      body: { code: 'MATRIX_ROLE', name: 'Matrix role', permissions: ['iam.unit.manage'], rank: 10 },
    }),
  },
  updateCustomRole: {
    referencesTenantIds: true,
    build: (t) => ({ method: 'PUT', path: `/roles/${t.customRoleId}`, ifMatch: '"1"', body: { permissions: ['iam.unit.manage'], reason: REASON } }),
  },
  grantRole: {
    referencesTenantIds: true,
    build: (t) => ({
      method: 'POST',
      path: '/role-grants',
      body: { membership_id: t.recipientMembershipId, role_id: t.memberRoleId, scope_kind: 'TENANT', reason: REASON },
    }),
  },
  revokeRoleGrant: {
    referencesTenantIds: true,
    build: (t) => ({ method: 'POST', path: `/role-grants/${t.grantToRevoke}/revoke`, ifMatch: '"1"', body: { reason: REASON } }),
  },
  placeLegalHold: {
    referencesTenantIds: false,
    build: () => ({
      method: 'POST',
      path: '/legal-holds',
      body: { hold_kind: 'AUDIT', resource_scope: { kind: 'TENANT', ids: [] }, authority_reference: 'MATRIX-HOLD-REF', reason: REASON },
    }),
  },
  releaseLegalHold: {
    referencesTenantIds: true,
    build: (t) => ({ method: 'POST', path: `/legal-holds/${t.legalHoldId}/release`, ifMatch: '"1"', body: { reason: REASON } }),
  },
  markNotificationRead: {
    referencesTenantIds: true,
    build: (t) => ({ method: 'POST', path: `/notifications/${t.notificationId}/read`, body: { opened_via: 'IN_APP' } }),
  },
  acknowledgeNotification: {
    referencesTenantIds: true,
    build: (t) => ({ method: 'POST', path: `/notifications/${t.notificationId}/acknowledge`, body: {} }),
  },
};

export type MatrixCaseKind = 'role' | 'wrong-tenant' | 'control-plane';

export interface MatrixCase {
  id: string;
  operationId: string;
  kind: MatrixCaseKind;
  /** The system role the caller holds alone (kind `role`). */
  roleCode?: string;
}

export interface MatrixOperation {
  operationId: string;
  permission: string;
  plane: string;
}

/** The generated permission, plane of each command, read from the same table the policy guard uses. */
export function operationsOf(operationIds: readonly string[]): MatrixOperation[] {
  return operationIds.map((operationId) => {
    const permission = (PERMISSIONS as Readonly<Record<string, string>>)[operationId];
    if (permission === undefined) throw new Error(`operation ${operationId} has no permission in the generated table`);
    return { operationId, permission, plane: 'tenant' };
  });
}

/**
 * The negative cases of ST-IAM-004 TK-5: for every command, one case per system role whose seeded
 * permissions do not match the command's permission, plus a wrong-tenant caller and a control-plane
 * audience. Order is stable (operations as given, roles by seed order).
 */
export function negativeCasesFor(operations: readonly MatrixOperation[], roles: readonly SystemRole[]): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const operation of operations) {
    for (const role of roles) {
      if (holdsPermission(new Set(role.permissions), operation.permission)) continue;
      cases.push({ id: `${operation.operationId}:role:${role.code}`, operationId: operation.operationId, kind: 'role', roleCode: role.code });
    }
    cases.push({ id: `${operation.operationId}:wrong-tenant`, operationId: operation.operationId, kind: 'wrong-tenant' });
    cases.push({ id: `${operation.operationId}:control-plane`, operationId: operation.operationId, kind: 'control-plane' });
  }
  return cases;
}

export interface Observation {
  status: number;
  code: unknown;
  text: string;
  /** DENIED audit rows `authz.denied:<operation>` of the caller written by this request. */
  deniedRows: number;
  /** The tenant state fingerprint changed during this request. */
  stateChanged: boolean;
}

/** Failures of a case that must be refused by the policy guard (kinds `role` and `control-plane`). */
export function evaluateGuardDenial(observation: Observation): string[] {
  const failures: string[] = [];
  if (observation.status !== 403) failures.push(`answered ${observation.status} instead of 403`);
  if (observation.code !== 'SCOPE_DENIED') failures.push(`code ${String(observation.code)} instead of SCOPE_DENIED`);
  if (observation.deniedRows !== 1) failures.push(`${observation.deniedRows} DENIED audit rows instead of 1`);
  if (observation.stateChanged) failures.push('tenant state changed');
  return failures;
}

/**
 * Failures of a wrong-tenant case: nothing of tenant A in the body and nothing changed in tenant A; when the request
 * names ids of tenant A it must also be refused or not found.
 */
export function evaluateWrongTenant(observation: Observation, foreignMarkers: readonly string[], referencesTenantIds = true): string[] {
  const failures: string[] = [];
  if (referencesTenantIds && observation.status !== 403 && observation.status !== 404) failures.push(`answered ${observation.status} instead of 403 or 404`);
  const lowered = observation.text.toLowerCase();
  for (const marker of foreignMarkers) if (lowered.includes(marker.toLowerCase())) failures.push('body exposes data of another tenant');
  if (observation.stateChanged) failures.push('tenant state changed');
  return failures;
}
