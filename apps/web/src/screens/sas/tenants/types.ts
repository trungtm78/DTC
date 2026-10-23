/** The seven states of a tenant (SAS 3.1); the registry never returns another one. */
export const TENANT_STATUSES = ['Requested', 'Provisioning', 'Active', 'Failed', 'Suspended', 'Offboarding', 'Archived'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Permission that creates tenants and retries provisioning; without it the SAS screens are read-only. */
export const MANAGE_TENANTS_PERMISSION = 'system.tenant.manage';
/** Permission that reads the registry and the entitlements of any tenant (the control plane). */
export const READ_TENANTS_PERMISSION = 'system.tenant.read';

export const REGIONS = ['vn-north', 'vn-south'] as const;
export const ISOLATION_MODES = ['POOL', 'SILO'] as const;
export const GOVERNING_BODY_TYPES = ['PROVINCE', 'MINISTRY', 'CENTRAL_AGENCY'] as const;

export type Region = (typeof REGIONS)[number];
export type IsolationMode = (typeof ISOLATION_MODES)[number];
export type GoverningBodyType = (typeof GOVERNING_BODY_TYPES)[number];

/** A row of the tenant list (`TenantSummaryPage` of the contract). */
export interface TenantSummary {
  id: string;
  code: string;
  name: string;
  status: string;
  isolationMode: string | undefined;
  planCode: string | undefined;
  licenseStatus: string | undefined;
}

/** One step of a provisioning run as the registry reports it. */
export interface RunStep {
  step: string;
  status: string;
  attempts: number;
  errorCode: string | undefined;
}

/** The provisioning run of a tenant (`TenantDetail.provisioning`). */
export interface TenantRun {
  runId: string | undefined;
  attempt: number | undefined;
  currentStep: string | undefined;
  steps: RunStep[];
}

export interface TenantDetail {
  id: string;
  code: string;
  status: string;
  version: number;
  run: TenantRun | undefined;
}

export function isTenantStatus(value: string): value is TenantStatus {
  return (TENANT_STATUSES as readonly string[]).includes(value);
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export function toTenantSummary(raw: unknown): TenantSummary {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(row.id) ?? '',
    code: text(row.code) ?? '',
    name: text(row.name) ?? text(row.code) ?? '',
    status: text(row.status) ?? '',
    isolationMode: text(row.isolation_mode),
    planCode: text(row.plan_code),
    licenseStatus: text(row.license_status),
  };
}

export function toTenantDetail(raw: unknown): TenantDetail {
  const row = (raw ?? {}) as Record<string, unknown>;
  const provisioning = row.provisioning as Record<string, unknown> | undefined;
  const steps = Array.isArray(provisioning?.steps) ? (provisioning.steps as Array<Record<string, unknown>>) : [];
  return {
    id: text(row.id) ?? '',
    code: text(row.code) ?? '',
    status: text(row.status) ?? '',
    version: typeof row.version === 'number' ? row.version : 0,
    run:
      provisioning === undefined
        ? undefined
        : {
            runId: text(provisioning.run_id),
            attempt: typeof provisioning.attempt === 'number' ? provisioning.attempt : undefined,
            currentStep: text(provisioning.current_step),
            steps: steps.map((step) => ({
              step: text(step.step) ?? '',
              status: text(step.status) ?? '',
              attempts: typeof step.attempts === 'number' ? step.attempts : 0,
              errorCode: text(step.error_code),
            })),
          },
  };
}

/** The step a run failed on, when it has; undefined for a run that has not failed. */
export function failedStepOf(run: TenantRun | undefined): RunStep | undefined {
  return run?.steps.find((step) => step.status === 'FAILED');
}

/** Whether the registry offers a retry: only a tenant whose provisioning failed. */
export function canRetry(status: string): boolean {
  return status === 'Failed';
}

/** A tenant whose run is worth showing step by step: the saga is working or has stopped on an error. */
export function showsRun(status: string): boolean {
  return status === 'Provisioning' || status === 'Failed' || status === 'Requested';
}
