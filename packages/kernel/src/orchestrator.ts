import { DomainError } from './errors.ts';
import type { TenantContext } from './tenant-context.ts';

const WORKFLOW_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** What a guard and an activity are told about the signal being delivered. */
export interface SignalRequest {
  workflow: string;
  state: string;
  signal: string;
  payload: unknown;
  /** The input the instance was started with. */
  input: unknown;
  /** The tenant context re-established from the signed token; never read from the payload. */
  context: TenantContext;
}

/**
 * One edge of a workflow. The guard is the domain rule of the transition (who may decide, which amount, which period):
 * a guard that returns false refuses the signal and the workflow keeps waiting in its state.
 */
export interface Transition {
  from: string;
  signal: string;
  to: string;
  guard?: (request: SignalRequest) => boolean;
  /** Runs under the verified context once the guard passed; when it throws the workflow stays in `from`. */
  activity?: (request: SignalRequest) => Promise<void>;
}

/** A workflow as data: a finite state machine whose terminal states end the instance. */
export interface WorkflowDefinition {
  name: string;
  /** Instances follow the version they started on; a newer version only applies to instances started after it. */
  version: number;
  initialState: string;
  terminalStates: readonly string[];
  transitions: readonly Transition[];
}

export interface WorkflowSnapshot {
  id: string;
  workflow: string;
  version: number;
  state: string;
  status: 'WAITING' | 'COMPLETED';
  tenantId: string;
}

/**
 * The orchestration port. Every call carries the signed tenant context token (signTenantContext): a token that does
 * not verify fails with TENANT_CONTEXT_INVALID before anything is read, started or written. The in-process adapter and
 * a Temporal adapter are interchangeable behind it.
 */
export interface OrchestratorPort {
  register(definition: WorkflowDefinition): void;
  start(workflow: string, input: unknown, signedContext: string): Promise<WorkflowSnapshot>;
  signal(instanceId: string, signal: string, payload: unknown, signedContext: string): Promise<WorkflowSnapshot>;
  describe(instanceId: string, signedContext: string): Promise<WorkflowSnapshot>;
}

function invalid(definition: WorkflowDefinition, detail: string): DomainError {
  return new DomainError('WORKFLOW_DEFINITION_INVALID', 422, `${definition.name}: ${detail}`);
}

/** Validates a definition once, so a malformed workflow fails when it is registered and never in the middle of an instance. */
export function defineWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  if (!WORKFLOW_NAME.test(definition.name)) throw invalid(definition, 'name');
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) throw invalid(definition, 'version');
  const terminal = new Set(definition.terminalStates);
  if (terminal.size === 0) throw invalid(definition, 'terminalStates');
  if (terminal.has(definition.initialState)) throw invalid(definition, 'initialState');
  const edges = new Set<string>();
  const leavable = new Set<string>();
  const entered = new Set<string>([definition.initialState]);
  for (const transition of definition.transitions) {
    const edge = `${transition.from}\u0000${transition.signal}`;
    if (terminal.has(transition.from)) throw invalid(definition, `transitions: ${transition.from} is terminal`);
    if (edges.has(edge)) throw invalid(definition, `transitions: ${transition.from} on ${transition.signal} twice`);
    edges.add(edge);
    leavable.add(transition.from);
    entered.add(transition.to);
  }
  if (!leavable.has(definition.initialState)) throw invalid(definition, 'initialState');
  for (const state of entered) {
    if (!terminal.has(state) && !leavable.has(state)) throw invalid(definition, `transitions: ${state} is a dead end`);
  }
  return definition;
}

/** The transition a signal takes from a state, or undefined when the state does not accept the signal. */
export function transitionOf(definition: WorkflowDefinition, state: string, signal: string): Transition | undefined {
  return definition.transitions.find((transition) => transition.from === state && transition.signal === signal);
}

/**
 * The domain transition guard. A signal the state does not accept (a second decision on a finished instance, an
 * unknown signal) is WORKFLOW_STATE_INVALID (409); a signal the guard refuses is SCOPE_DENIED (403). Either way the
 * instance is left as it was and keeps waiting.
 */
export function nextState(definition: WorkflowDefinition, request: SignalRequest): string {
  const transition = transitionOf(definition, request.state, request.signal);
  if (transition === undefined) throw new DomainError('WORKFLOW_STATE_INVALID', 409);
  if (transition.guard !== undefined && !transition.guard(request)) throw new DomainError('SCOPE_DENIED', 403);
  return transition.to;
}
