import { randomUUID } from 'node:crypto';
import { DomainError, defineWorkflow, nextState, transitionOf } from '@machvon/kernel';
import type { OrchestratorPort, SignalRequest, TenantContext, WorkflowDefinition, WorkflowSnapshot } from '@machvon/kernel';

export interface InProcessOrchestratorOptions {
  /** Re-establishes the tenant context of a signed token or throws TENANT_CONTEXT_INVALID (verifyTenantContext with the signing key). */
  verify: (signedContext: string) => TenantContext;
  newId?: () => string;
}

interface Instance {
  id: string;
  tenantId: string;
  definition: WorkflowDefinition;
  state: string;
  input: unknown;
  /** Signals of one instance run one after the other, so two concurrent decisions cannot both win. */
  tail: Promise<unknown>;
}

/** A frozen copy of the definition, its terminal states and every transition record (the guards and activities are shared functions). */
function ownedCopy(definition: WorkflowDefinition): WorkflowDefinition {
  return Object.freeze({
    ...definition,
    terminalStates: Object.freeze([...definition.terminalStates]),
    transitions: Object.freeze(definition.transitions.map((transition) => Object.freeze({ ...transition }))),
  });
}

function snapshotOf(instance: Instance): WorkflowSnapshot {
  return {
    id: instance.id,
    workflow: instance.definition.name,
    version: instance.definition.version,
    state: instance.state,
    status: instance.definition.terminalStates.includes(instance.state) ? 'COMPLETED' : 'WAITING',
    tenantId: instance.tenantId,
  };
}

/**
 * The orchestration port without a workflow engine, for tests, local development and deployments that do not run
 * Temporal yet. Instances live in this process only; a Temporal adapter replaces it behind the same port.
 */
export class InProcessOrchestrator implements OrchestratorPort {
  private readonly verify: (signedContext: string) => TenantContext;
  private readonly newId: () => string;
  /** Every registered version of every workflow: an instance keeps the definition it started on. */
  private readonly definitions = new Map<string, Map<number, WorkflowDefinition>>();
  private readonly instances = new Map<string, Instance>();

  constructor(options: InProcessOrchestratorOptions) {
    this.verify = options.verify;
    this.newId = options.newId ?? randomUUID;
  }

  register(definition: WorkflowDefinition): void {
    // The registry owns what it registered: the caller may go on editing its object to prepare the next version, and an
    // instance started on this one must not follow (version pinning).
    const owned = ownedCopy(definition);
    defineWorkflow(owned);
    const versions = this.definitions.get(definition.name) ?? new Map<number, WorkflowDefinition>();
    if ([...versions.keys()].some((version) => version >= definition.version)) {
      throw new DomainError('WORKFLOW_DEFINITION_INVALID', 422, `${definition.name}: version ${definition.version} is not newer than the registered ones`);
    }
    versions.set(owned.version, owned);
    this.definitions.set(definition.name, versions);
  }

  async start(workflow: string, input: unknown, signedContext: string): Promise<WorkflowSnapshot> {
    const context = this.verify(signedContext);
    const versions = this.definitions.get(workflow);
    if (versions === undefined) throw new DomainError('WORKFLOW_NOT_CONFIGURED', 422);
    const definition = versions.get(Math.max(...versions.keys()));
    if (definition === undefined) throw new DomainError('WORKFLOW_NOT_CONFIGURED', 422);
    const instance: Instance = { id: this.newId(), tenantId: context.tenantId, definition, state: definition.initialState, input, tail: Promise.resolve() };
    this.instances.set(instance.id, instance);
    return snapshotOf(instance);
  }

  async signal(instanceId: string, signal: string, payload: unknown, signedContext: string): Promise<WorkflowSnapshot> {
    const context = this.verify(signedContext);
    const instance = this.find(instanceId, context);
    const run = instance.tail.then(() => this.deliver(instance, { signal, payload, context }));
    instance.tail = run.catch(() => undefined);
    return await run;
  }

  async describe(instanceId: string, signedContext: string): Promise<WorkflowSnapshot> {
    return snapshotOf(this.find(instanceId, this.verify(signedContext)));
  }

  /** An instance of another tenant is not found: the caller learns nothing about its existence. */
  private find(instanceId: string, context: TenantContext): Instance {
    const instance = this.instances.get(instanceId);
    if (instance === undefined || instance.tenantId !== context.tenantId) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return instance;
  }

  private async deliver(instance: Instance, delivery: Pick<SignalRequest, 'signal' | 'payload' | 'context'>): Promise<WorkflowSnapshot> {
    const request: SignalRequest = { ...delivery, workflow: instance.definition.name, state: instance.state, input: instance.input };
    const to = nextState(instance.definition, request);
    await transitionOf(instance.definition, instance.state, delivery.signal)?.activity?.(request);
    instance.state = to;
    return snapshotOf(instance);
  }
}
