import { consumeOnce } from '@machvon/db';
import type { ConsumeSecurity, SignedDelivery, TenantDatabase, TenantRegistry } from '@machvon/db';
import type { ProvisioningSaga } from './saga';
import type { WorkflowRunner } from './workflow-runner';

/** The event that asks for a provisioning run to start (SAS 3.1 steps 1 and 2); also emitted by a retry. */
export const TENANT_REQUESTED_EVENT = 'sas.tenant.requested.v1';
export const PROVISIONING_CONSUMER = 'tenant-provisioning';

export const workflowIdOf = (tenantId: string, attempt: number): string => `prov:${tenantId}:${attempt}`;

export interface ProvisioningDelivery extends SignedDelivery {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Starts the provisioning workflow once per delivered `sas.tenant.requested.v1`: the inbox row of consumeOnce makes
 * a redelivery (relay retry, crash after the insert) a duplicate, and the workflow id makes a second start a no-op.
 */
export class ProvisioningConsumer {
  constructor(
    private readonly database: TenantDatabase,
    private readonly saga: ProvisioningSaga,
    private readonly runner: WorkflowRunner,
    private readonly security: ConsumeSecurity,
  ) {}

  async handle(delivery: ProvisioningDelivery): Promise<'processed' | 'duplicate' | 'ignored'> {
    if (delivery.type !== TENANT_REQUESTED_EVENT) return 'ignored';
    const attempt = delivery.payload.attempt;
    if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 1) return 'ignored';
    return consumeOnce(
      this.database,
      delivery,
      PROVISIONING_CONSUMER,
      async () => {
        await this.runner.start(workflowIdOf(delivery.tenantId, attempt), async () => {
          await this.saga.run(delivery.tenantId, attempt);
        });
      },
      this.security,
    );
  }
}

/** After a restart: starts again the runs that were Running when the process died (their steps are idempotent). */
export async function resumeUnfinishedRuns(registry: TenantRegistry, saga: ProvisioningSaga, runner: WorkflowRunner): Promise<number> {
  const runs = await registry.unfinishedRuns();
  for (const run of runs) {
    await runner.start(workflowIdOf(run.tenantId, run.attempt), async () => {
      await saga.run(run.tenantId, run.attempt);
    });
  }
  return runs.length;
}
