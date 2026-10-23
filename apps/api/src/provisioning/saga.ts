import { PROVISIONING_STEPS } from '@machvon/db';
import type { RunRow, TenantRegistry, TenantRow, TenantTx } from '@machvon/db';
import { DomainError, NOOP_METRICS } from '@machvon/kernel';
import type { MetricsSink } from '@machvon/kernel';
import type { ProvisioningPorts } from './ports';
import { INFRASTRUCTURE_STEP_DEFINITIONS } from './steps';
import type { StepContext, StepDefinition } from './steps';

/** Back-off before each retry of a step (SAS 3.1 step 5): 10 s, 1 min, 5 min, so a step is tried at most four times. */
export const RETRY_DELAYS_SECONDS: readonly number[] = [10, 60, 300];

export interface SagaOptions {
  retryDelaysSeconds?: readonly number[];
  /** Waits before a retry; tests record the seconds instead of waiting. */
  delay: (seconds: number) => Promise<void>;
  steps?: readonly StepDefinition[];
  /** Runs in the transaction that makes the tenant Active, when this run finished the last step (audit row and event of the move). */
  onCompleted?: (tx: TenantTx, tenant: TenantRow, run: RunRow) => Promise<void>;
  metrics?: MetricsSink;
  now?: () => Date;
}

/**
 * `Completed`: every step of this saga is DONE (when the saga holds all eleven steps the tenant is Active and the run
 * Succeeded, otherwise the tenant stays Provisioning until the remaining steps are run); `Failed`: a step ran out of retries, the run and the tenant are Failed.
 */
export type SagaOutcome = 'Completed' | 'Failed';

/** The code a failed step records: the registered code of a DomainError, an error `code` string, else a generic one. Messages never leave. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof DomainError) return error.code;
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'STEP_FAILED';
}

/**
 * Runs the infrastructure steps of tenant provisioning over the ports. Each step is recorded before and after its
 * port call, so a runner that dies and starts again repeats nothing that is DONE and repeats a half-done step
 * safely (every step is idempotent by its natural key). Temporal replaces this runner behind WorkflowRunner later.
 */
export class ProvisioningSaga {
  private readonly steps: readonly StepDefinition[];
  private readonly delays: readonly number[];
  private readonly metrics: MetricsSink;
  private readonly now: () => Date;

  constructor(
    private readonly registry: TenantRegistry,
    private readonly ports: ProvisioningPorts,
    private readonly options: SagaOptions,
  ) {
    this.steps = options.steps ?? INFRASTRUCTURE_STEP_DEFINITIONS;
    this.delays = options.retryDelaysSeconds ?? RETRY_DELAYS_SECONDS;
    this.metrics = options.metrics ?? NOOP_METRICS;
    this.now = options.now ?? (() => new Date());
  }

  async run(tenantId: string, attempt: number): Promise<SagaOutcome> {
    const tenant = await this.registry.getTenant(tenantId);
    const run = await this.registry.loadRun(tenantId, attempt);
    if (tenant === undefined || run === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    // A run that has ended is never run again: a redelivered event must not undo a Failed run or restart a finished one.
    if (run.status !== 'Running') return run.status === 'Failed' ? 'Failed' : 'Completed';
    if (tenant.status === 'Requested') await this.registry.transition(tenantId, 'Requested', 'Provisioning');
    else if (tenant.status !== 'Provisioning') throw new DomainError('TENANT_STATE_INVALID', 409, `${tenant.status}->Provisioning`);

    for (const definition of this.steps) {
      if (run.steps[definition.step].status === 'DONE') continue;
      const failure = await this.runStep({ tenant, run, ports: this.ports, registry: this.registry }, definition);
      if (failure !== undefined) {
        // One transaction: a crash must not leave a Failed run beside a tenant that is still Provisioning.
        await this.registry.failRun(tenantId, run.id, failure, definition.step);
        this.metrics.increment('tenant_provisioning_failed_total', { step: definition.step });
        return 'Failed';
      }
    }
    // The tenant is Active only after the last step: when the steps of this saga and the ones already DONE cover all eleven, the run ends.
    const covered = PROVISIONING_STEPS.every((step) => this.steps.some((definition) => definition.step === step) || run.steps[step].status === 'DONE');
    if (covered) {
      const { onCompleted } = this.options;
      await this.registry.completeRun(tenantId, run.id, onCompleted === undefined ? undefined : (tx) => onCompleted(tx, tenant, run));
      this.metrics.increment('tenant_provisioning_completed_total');
      return 'Completed';
    }
    const next = PROVISIONING_STEPS.find((step) => !this.steps.some((definition) => definition.step === step) && run.steps[step].status !== 'DONE');
    if (next !== undefined) await this.registry.setCurrentStep(tenantId, run.id, next);
    this.metrics.increment('tenant_provisioning_steps_completed_total');
    return 'Completed';
  }

  /** Returns the error code when the step failed for good, undefined when it is DONE. */
  private async runStep(context: StepContext, definition: StepDefinition): Promise<string | undefined> {
    const { tenant, run } = context;
    const maxAttempts = this.delays.length + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.registry.updateStep(tenant.id, run.id, definition.step, { status: 'RUNNING', attempts: attempt, started_at: this.now().toISOString() }, definition.step);
      try {
        await definition.execute(context);
        await this.registry.updateStep(tenant.id, run.id, definition.step, { status: 'DONE', error_code: null, finished_at: this.now().toISOString() });
        return undefined;
      } catch (error) {
        // A refusal the system itself decided (a DomainError) cannot get better by waiting; only infrastructure failures are retried.
        const permanent = error instanceof DomainError;
        const code = errorCodeOf(error);
        if (permanent || attempt === maxAttempts) {
          await this.registry.updateStep(tenant.id, run.id, definition.step, { status: 'FAILED', error_code: code, finished_at: this.now().toISOString() });
          return code;
        }
        await this.registry.updateStep(tenant.id, run.id, definition.step, { error_code: code });
      }
      await this.options.delay(this.delays[attempt - 1] ?? 0);
    }
    return 'STEP_FAILED';
  }

  /**
   * Undoes the steps of an attempt in reverse order (provisioning cancelled). A step that stopped half way (RUNNING or
   * FAILED) is undone too, since its port call may have taken effect. The tenant status is left to the archive command.
   */
  async compensate(tenantId: string, attempt: number): Promise<void> {
    const tenant = await this.registry.getTenant(tenantId);
    const run = await this.registry.loadRun(tenantId, attempt);
    if (tenant === undefined || run === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    for (const definition of [...this.steps].reverse()) {
      const status = run.steps[definition.step].status;
      if (status === 'PENDING' || status === 'COMPENSATED') continue;
      await definition.compensate({ tenant, run, ports: this.ports, registry: this.registry });
      await this.registry.updateStep(tenantId, run.id, definition.step, { status: 'COMPENSATED', finished_at: this.now().toISOString() });
    }
  }
}
