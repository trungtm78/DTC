import { PERMISSIONS } from '@machvon/contracts';
import { CONTROL_ROLES, holdsPermission } from '@machvon/kernel';
import type { ControlRole } from '@machvon/kernel';

/** A control-plane operation of the matrix: its permission comes from the generated table, never from this file. */
export interface ControlOperation {
  operationId: string;
  permission: string;
  method: 'GET' | 'POST';
  /** Path with `{tenantId}` for the tenant the request names. */
  path: string;
}

export interface ControlCase {
  id: string;
  operationId: string;
  role: ControlRole;
  /** What the realm role must get: the operation is allowed only to a role whose permissions cover the permission. */
  expected: 'allow' | 'deny';
}

export const CONTROL_ROLE_NAMES = Object.keys(CONTROL_ROLES) as ControlRole[];

/**
 * One case per control-plane operation and realm role. A role allowed by its permissions must pass the guard, any other
 * must get 403 SCOPE_DENIED (and, for a command, a DENIED audit row on the platform tenant). The expectation is
 * derived from CONTROL_ROLES and the permission of the operation, so adding a role or an operation extends the matrix.
 */
export function controlCasesFor(operations: readonly ControlOperation[]): ControlCase[] {
  return operations.flatMap((operation) =>
    CONTROL_ROLE_NAMES.map((role) => ({
      id: `${operation.operationId}:${role}`,
      operationId: operation.operationId,
      role,
      expected: holdsPermission(new Set(CONTROL_ROLES[role]), operation.permission) ? ('allow' as const) : ('deny' as const),
    })),
  );
}

/** The control-plane operations of the registry: the commands of the matrix file and the two reads. */
export const CONTROL_OPERATIONS: readonly ControlOperation[] = [
  { operationId: 'requestTenantProvisioning', permission: PERMISSIONS.requestTenantProvisioning, method: 'POST', path: '/system/tenants' },
  { operationId: 'retryTenantProvisioning', permission: PERMISSIONS.retryTenantProvisioning, method: 'POST', path: '/system/tenants/{tenantId}/provisioning/retry' },
  { operationId: 'suspendTenant', permission: PERMISSIONS.suspendTenant, method: 'POST', path: '/system/tenants/{tenantId}/suspend' },
  { operationId: 'resumeTenant', permission: PERMISSIONS.resumeTenant, method: 'POST', path: '/system/tenants/{tenantId}/resume' },
  { operationId: 'listSystemTenants', permission: PERMISSIONS.listSystemTenants, method: 'GET', path: '/system/tenants' },
  { operationId: 'getSystemTenant', permission: PERMISSIONS.getSystemTenant, method: 'GET', path: '/system/tenants/{tenantId}' },
];

