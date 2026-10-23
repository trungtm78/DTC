import type { ConsumeSecurity, TenantDatabase, TenantRegistry } from '@machvon/db';
import { ProvisioningConsumer } from './provisioning.consumer';
import { activationRecorder, createProvisioningSteps } from './provisioning-steps';
import type { ProvisioningServices } from './provisioning-steps';
import type { ProvisioningPorts } from './ports';
import { ProvisioningSaga } from './saga';
import { InProcessWorkflowRunner } from './workflow-runner';
import type { WorkflowRunner } from './workflow-runner';

export interface ProvisioningWiring {
  tenants: TenantDatabase;
  registry: TenantRegistry;
  /** What steps 6 to 11 write besides the registry. */
  services: ProvisioningServices;
  /** The infrastructure steps' world: the identity provider, DNS, certificates, storage, placement. */
  ports: ProvisioningPorts;
  /** Key and alert sink of the signed delivery context (the relay signs with the same key). */
  security: ConsumeSecurity;
  /** Waits before a retry of a step; defaults to really waiting (tests give a recorder). */
  delay?: (seconds: number) => Promise<void>;
  runner?: WorkflowRunner;
}

const waitSeconds = (seconds: number): Promise<void> => new Promise((done) => setTimeout(done, seconds * 1000));

/**
 * The provisioning saga with all eleven steps behind the consumer of `sas.tenant.requested.v1`: the one wiring the API
 * process and the end-to-end stack share, so the stack exercises the code that runs in production.
 */
export function createProvisioningConsumer(wiring: ProvisioningWiring): ProvisioningConsumer {
  const saga = new ProvisioningSaga(wiring.registry, wiring.ports, {
    steps: createProvisioningSteps(wiring.services),
    onCompleted: activationRecorder(wiring.services),
    delay: wiring.delay ?? waitSeconds,
  });
  return new ProvisioningConsumer(wiring.tenants, saga, wiring.runner ?? new InProcessWorkflowRunner(), wiring.security);
}
