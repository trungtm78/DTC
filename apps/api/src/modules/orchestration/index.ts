import { verifyTenantContext } from '@machvon/kernel';
import type { OrchestratorPort, WorkflowDefinition } from '@machvon/kernel';
import { defineModule } from '../module-descriptor';
import { InProcessOrchestrator } from './in-process-orchestrator';

/** Injection token of the orchestration port. */
export const ORCHESTRATOR = Symbol('ORCHESTRATOR');
/** Injection token of the options AppModule passes through `orchestration`. */
export const ORCHESTRATION_OPTIONS = Symbol('ORCHESTRATION_OPTIONS');

export interface OrchestrationOptions {
  /** The key that signs the tenant contexts of background work (signTenantContext). */
  contextKey: Buffer;
  /** The workflows to register at start-up. */
  definitions?: readonly WorkflowDefinition[];
}

function createOrchestrator(options: OrchestrationOptions): OrchestratorPort {
  const orchestrator = new InProcessOrchestrator({ verify: (token) => verifyTenantContext(token, options.contextKey) });
  for (const definition of options.definitions ?? []) orchestrator.register(definition);
  return orchestrator;
}

/**
 * KERNEL-044: the orchestration port behind which a workflow engine plugs in. Active when `orchestration` is given to
 * AppModule; it provides the in-process adapter until the Temporal adapter exists.
 */
export const orchestrationModule = defineModule({
  code: 'ORCH',
  controllers: [],
  providers: [{ provide: ORCHESTRATOR, useFactory: createOrchestrator, inject: [ORCHESTRATION_OPTIONS] }],
  enabled: (options) => options.orchestration !== undefined,
});
