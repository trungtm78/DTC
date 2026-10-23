import { DomainError, versionConflict } from '@machvon/kernel';
import { assertTenantTransition } from './tenant-registry.ts';
import type { TenantStatus } from './tenant-registry.ts';
import type { TenantTx } from './tenant-database.ts';

/** Why a tenant is suspended (SAS 3.6, `TenantSuspend.reason_code`). */
export const SUSPENSION_REASONS = ['NON_PAYMENT', 'SECURITY_INCIDENT', 'CUSTOMER_REQUEST', 'LICENSE_REVOKED', 'LEGAL_ORDER'] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

/** What a suspended tenant may still do: read and export, or nothing (a security incident). */
export type SuspensionAccessPolicy = 'READ_ONLY_EXPORT' | 'NO_ACCESS';

/** The change a state command made; the hook that runs inside the command receives it. */
export interface StateChange {
  tenantId: string;
  from: TenantStatus;
  to: TenantStatus;
  version: number;
  reasonCode?: SuspensionReason;
}

export interface SuspendInput {
  tenantId: string;
  reasonCode: SuspensionReason;
  accessPolicy: SuspensionAccessPolicy;
  expectedVersion: number;
  /** The tenant the command transaction acts as outside the hook (the platform tenant). */
  restoreTenantId: string;
}

export interface ResumeInput {
  tenantId: string;
  expectedVersion: number;
  restoreTenantId: string;
}

/**
 * The access policy a reason implies. The database function `tenant_runtime` derives the policy from the stored
 * reason (a security incident is NO_ACCESS, every other suspension READ_ONLY_EXPORT), so the request may only name the
 * policy that agrees with its reason.
 */
export function accessPolicyOf(reason: SuspensionReason): SuspensionAccessPolicy {
  return reason === 'SECURITY_INCIDENT' ? 'NO_ACCESS' : 'READ_ONLY_EXPORT';
}

export function assertPolicyMatchesReason(reason: SuspensionReason, policy: SuspensionAccessPolicy): void {
  if (accessPolicyOf(reason) !== policy) throw new DomainError('VALIDATION_FAILED', 422, 'access_policy');
}

interface StateRow {
  status: TenantStatus;
  version: string;
}

const LOCK_SQL = 'select status, version::text as version from machvon.tenant where id = $1::uuid for update';

const SUSPEND_SQL = `update machvon.tenant
  set status = 'Suspended', lifecycle_reason = $2, suspended_at = now(), version = version + 1
  where id = $1::uuid returning version::text as version`;

const RESUME_SQL = `update machvon.tenant
  set status = 'Active', lifecycle_reason = null, suspended_at = null, version = version + 1
  where id = $1::uuid returning version::text as version`;

async function actAs(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}

// Locks the tenant row, so two operators serialise, and checks the version and the lifecycle table.
async function lockedState(tx: TenantTx, tenantId: string, expectedVersion: number, required: TenantStatus, to: TenantStatus): Promise<TenantStatus> {
  const [state] = await tx.query<StateRow>(LOCK_SQL, [tenantId]);
  if (state === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
  if (Number(state.version) !== expectedVersion) throw versionConflict(Number(state.version));
  // Resuming is the way out of Suspended only: an Offboarding tenant returns to Active through a renewal, not through this command.
  if (state.status !== required) throw new DomainError('TENANT_STATE_INVALID', 409, `${state.status}->${to}`);
  assertTenantTransition(state.status, to);
  return state.status;
}

async function runHook(tx: TenantTx, change: StateChange, restoreTenantId: string, hook: (change: StateChange) => Promise<void>): Promise<void> {
  // The audit row and the event of the change belong to the affected tenant: the transaction acts as that tenant while they are written.
  await actAs(tx, change.tenantId);
  await hook(change);
  await actAs(tx, restoreTenantId);
}

/**
 * Active to Suspended inside the transaction of a control-plane command. `whileActing` runs while the transaction
 * acts as the suspended tenant (audit row, events); the version is bumped so an operator with a stale view is refused.
 */
export async function suspendTenant(tx: TenantTx, input: SuspendInput, whileActing: (change: StateChange) => Promise<void>): Promise<StateChange> {
  assertPolicyMatchesReason(input.reasonCode, input.accessPolicy);
  const from = await lockedState(tx, input.tenantId, input.expectedVersion, 'Active', 'Suspended');
  const [updated] = await tx.query<{ version: string }>(SUSPEND_SQL, [input.tenantId, input.reasonCode]);
  const change: StateChange = { tenantId: input.tenantId, from, to: 'Suspended', version: Number(updated?.version), reasonCode: input.reasonCode };
  await runHook(tx, change, input.restoreTenantId, whileActing);
  return change;
}

/** Suspended to Active; the reason and the suspension time are cleared, the history stays in the audit trail. */
export async function resumeTenant(tx: TenantTx, input: ResumeInput, whileActing: (change: StateChange) => Promise<void>): Promise<StateChange> {
  const from = await lockedState(tx, input.tenantId, input.expectedVersion, 'Suspended', 'Active');
  const [updated] = await tx.query<{ version: string }>(RESUME_SQL, [input.tenantId]);
  const change: StateChange = { tenantId: input.tenantId, from, to: 'Active', version: Number(updated?.version) };
  await runHook(tx, change, input.restoreTenantId, whileActing);
  return change;
}
