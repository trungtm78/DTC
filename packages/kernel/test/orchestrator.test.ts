import { DomainError } from '../src/errors.ts';
import { defineWorkflow, nextState } from '../src/orchestrator.ts';
import type { SignalRequest, WorkflowDefinition } from '../src/orchestrator.ts';
import type { TenantContext } from '../src/tenant-context.ts';

const CONTEXT: TenantContext = {
  tenantId: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
  membershipId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  scopeVersion: 1,
};

function approval(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: 'approval',
    version: 1,
    initialState: 'WAITING',
    terminalStates: ['APPROVED', 'REJECTED'],
    transitions: [
      { from: 'WAITING', signal: 'approve', to: 'APPROVED' },
      { from: 'WAITING', signal: 'reject', to: 'REJECTED', guard: (request) => request.payload === 'allowed' },
    ],
    ...overrides,
  };
}

function request(signal: string, payload: unknown = null): SignalRequest {
  return { signal, payload, input: null, context: CONTEXT, workflow: 'approval', state: 'WAITING' };
}

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('defineWorkflow', () => {
  it('returns a valid definition unchanged', () => {
    const definition = approval();
    expect(defineWorkflow(definition)).toBe(definition);
  });

  it.each([
    ['a name that is not lower-case words', { name: 'Approval Flow' }],
    ['a version that is not a positive integer', { version: 0 }],
    ['a non-integer version', { version: 1.5 }],
    ['an initial state that no transition leaves', { initialState: 'NOWHERE' }],
    ['an initial state that is terminal', { initialState: 'APPROVED' }],
    ['no terminal state', { terminalStates: [] }],
    ['a transition out of a terminal state', { transitions: [{ from: 'APPROVED', signal: 'again', to: 'WAITING' }, { from: 'WAITING', signal: 'approve', to: 'APPROVED' }] }],
    ['two transitions for the same state and signal', { transitions: [{ from: 'WAITING', signal: 'approve', to: 'APPROVED' }, { from: 'WAITING', signal: 'approve', to: 'REJECTED' }] }],
    ['a transition into a state nobody can leave that is not terminal', { transitions: [{ from: 'WAITING', signal: 'park', to: 'PARKED' }] }],
  ] satisfies [string, Partial<WorkflowDefinition>][])('rejects %s', (_label, overrides) => {
    expect(codeOf(() => defineWorkflow(approval(overrides)))).toBe('WORKFLOW_DEFINITION_INVALID');
  });
});

describe('nextState', () => {
  const definition = defineWorkflow(approval());

  it('follows the transition of the signal', () => {
    expect(nextState(definition, request('approve'))).toBe('APPROVED');
  });

  it('runs the guard with the signal, the payload and the verified context', () => {
    const seen: SignalRequest[] = [];
    const guarded = defineWorkflow(
      approval({ transitions: [{ from: 'WAITING', signal: 'approve', to: 'APPROVED', guard: (r) => { seen.push(r); return true; } }] }),
    );
    nextState(guarded, request('approve', { by: 'x' }));
    expect(seen).toEqual([{ ...request('approve', { by: 'x' }) }]);
  });

  it('refuses a domain-invalid signal with SCOPE_DENIED (403) when the guard says no', () => {
    const error = (() => {
      try {
        nextState(definition, request('reject', 'denied'));
      } catch (caught) {
        return caught as DomainError;
      }
      throw new Error('nextState did not throw');
    })();
    expect(error.code).toBe('SCOPE_DENIED');
    expect(error.status).toBe(403);
  });

  it('allows the guarded transition when the guard says yes', () => {
    expect(nextState(definition, request('reject', 'allowed'))).toBe('REJECTED');
  });

  it('refuses a signal the current state does not accept with WORKFLOW_STATE_INVALID (409)', () => {
    try {
      nextState(definition, { ...request('approve'), state: 'APPROVED' });
      throw new Error('nextState did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('WORKFLOW_STATE_INVALID');
      expect((error as DomainError).status).toBe(409);
    }
    expect(codeOf(() => nextState(definition, request('unknown-signal')))).toBe('WORKFLOW_STATE_INVALID');
  });
});
