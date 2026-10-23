import { randomBytes } from 'node:crypto';
import { DomainError, signTenantContext, verifyTenantContext } from '@machvon/kernel';
import type { SignalRequest, TenantContext, WorkflowDefinition } from '@machvon/kernel';
import { InProcessOrchestrator } from '../../src/modules/orchestration/in-process-orchestrator';

const KEY = randomBytes(32);
const TENANT = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTHER_TENANT = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const MEMBERSHIP = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const token = (tenantId = TENANT): string => signTenantContext({ tenantId, membershipId: MEMBERSHIP, scopeVersion: 1 }, KEY);

function tamper(signed: string, tenantId: string): string {
  const [payload, signature] = signed.split('.');
  const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as TenantContext;
  return `${Buffer.from(JSON.stringify({ ...decoded, tenantId }), 'utf8').toString('base64url')}.${signature}`;
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('the call did not fail');
}

interface Probe {
  activities: SignalRequest[];
  definition: WorkflowDefinition;
}

function approval(version = 1, options: { failActivity?: boolean } = {}): Probe {
  const activities: SignalRequest[] = [];
  const definition: WorkflowDefinition = {
    name: 'approval',
    version,
    initialState: 'WAITING',
    terminalStates: ['APPROVED', 'REJECTED'],
    transitions: [
      {
        from: 'WAITING',
        signal: 'approve',
        to: 'APPROVED',
        activity: async (request) => {
          activities.push(request);
          if (options.failActivity === true) throw new Error('activity failed');
        },
      },
      { from: 'WAITING', signal: 'reject', to: 'REJECTED', guard: (request) => request.payload === 'allowed' },
    ],
  };
  return { activities, definition };
}

function orchestratorWith(...definitions: WorkflowDefinition[]): InProcessOrchestrator {
  const orchestrator = new InProcessOrchestrator({ verify: (signed) => verifyTenantContext(signed, KEY) });
  for (const definition of definitions) orchestrator.register(definition);
  return orchestrator;
}

describe('InProcessOrchestrator', () => {
  it('starts an instance in the initial state, waiting, and describes it', async () => {
    const orchestrator = orchestratorWith(approval().definition);
    const started = await orchestrator.start('approval', { amount: 5 }, token());
    expect(started).toMatchObject({ workflow: 'approval', version: 1, state: 'WAITING', status: 'WAITING', tenantId: TENANT });
    expect(await orchestrator.describe(started.id, token())).toEqual(started);
  });

  it('moves on a valid signal, runs the activity under the verified context and completes at a terminal state', async () => {
    const probe = approval();
    const orchestrator = orchestratorWith(probe.definition);
    const { id } = await orchestrator.start('approval', { amount: 5 }, token());
    const done = await orchestrator.signal(id, 'approve', { by: 'x' }, token());
    expect(done).toMatchObject({ state: 'APPROVED', status: 'COMPLETED' });
    expect(probe.activities).toHaveLength(1);
    expect(probe.activities[0]).toMatchObject({ workflow: 'approval', state: 'WAITING', signal: 'approve', input: { amount: 5 }, payload: { by: 'x' } });
    expect(probe.activities[0]?.context).toEqual({ tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: 1 });
  });

  it('refuses a domain-invalid signal with SCOPE_DENIED (403) and the instance keeps waiting (AC-ST-KERNEL-044-1, AC-ST-KERNEL-005-3)', async () => {
    const orchestrator = orchestratorWith(approval().definition);
    const { id } = await orchestrator.start('approval', null, token());
    const error = await failure(orchestrator.signal(id, 'reject', 'denied', token()));
    expect(error).toMatchObject({ code: 'SCOPE_DENIED', status: 403 });
    expect(await orchestrator.describe(id, token())).toMatchObject({ state: 'WAITING', status: 'WAITING' });
    expect(await orchestrator.signal(id, 'reject', 'allowed', token())).toMatchObject({ state: 'REJECTED' });
  });

  it('lets exactly one of two concurrent decisions win; the other is refused with WORKFLOW_STATE_INVALID (409) (AC-ST-KERNEL-044-2)', async () => {
    const probe = approval();
    const orchestrator = orchestratorWith(probe.definition);
    const { id } = await orchestrator.start('approval', null, token());
    const results = await Promise.allSettled([orchestrator.signal(id, 'approve', null, token()), orchestrator.signal(id, 'reject', 'allowed', token())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'WORKFLOW_STATE_INVALID', status: 409 });
  });

  it('leaves the state alone when the activity fails', async () => {
    const orchestrator = orchestratorWith(approval(1, { failActivity: true }).definition);
    const { id } = await orchestrator.start('approval', null, token());
    await expect(orchestrator.signal(id, 'approve', null, token())).rejects.toThrow('activity failed');
    expect(await orchestrator.describe(id, token())).toMatchObject({ state: 'WAITING' });
    await expect(orchestrator.signal(id, 'approve', null, token())).rejects.toThrow('activity failed');
  });

  it('rejects a context whose tenant was modified with TENANT_CONTEXT_INVALID and runs nothing (AC-ST-KERNEL-005-2)', async () => {
    const probe = approval();
    const orchestrator = orchestratorWith(probe.definition);
    const { id } = await orchestrator.start('approval', null, token());
    const forged = tamper(token(), OTHER_TENANT);
    expect(await failure(orchestrator.start('approval', null, forged))).toMatchObject({ code: 'TENANT_CONTEXT_INVALID', status: 400 });
    expect(await failure(orchestrator.signal(id, 'approve', null, forged))).toMatchObject({ code: 'TENANT_CONTEXT_INVALID' });
    expect(await failure(orchestrator.describe(id, forged))).toMatchObject({ code: 'TENANT_CONTEXT_INVALID' });
    expect(probe.activities).toHaveLength(0);
    expect(await orchestrator.describe(id, token())).toMatchObject({ state: 'WAITING' });
  });

  it('does not reveal an instance of another tenant: RESOURCE_NOT_FOUND', async () => {
    const orchestrator = orchestratorWith(approval().definition);
    const { id } = await orchestrator.start('approval', null, token());
    expect(await failure(orchestrator.describe(id, token(OTHER_TENANT)))).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(await failure(orchestrator.signal(id, 'approve', null, token(OTHER_TENANT)))).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(await failure(orchestrator.describe('unknown-id', token()))).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('refuses to start a workflow that is not registered: WORKFLOW_NOT_CONFIGURED', async () => {
    expect(await failure(orchestratorWith().start('approval', null, token()))).toMatchObject({ code: 'WORKFLOW_NOT_CONFIGURED', status: 422 });
  });

  it('pins an instance to the definition it started on when a newer version is registered (AC-ST-KERNEL-005-1)', async () => {
    const orchestrator = orchestratorWith(approval(1).definition);
    const old = await orchestrator.start('approval', null, token());
    const next = approval(2).definition;
    orchestrator.register({
      ...next,
      transitions: [{ from: 'WAITING', signal: 'sign-off', to: 'APPROVED' }, ...next.transitions.filter((transition) => transition.signal === 'reject')],
    });
    const fresh = await orchestrator.start('approval', null, token());
    expect(old.version).toBe(1);
    expect(fresh.version).toBe(2);
    expect(await orchestrator.signal(old.id, 'approve', null, token())).toMatchObject({ state: 'APPROVED', version: 1 });
    expect(await failure(orchestrator.signal(fresh.id, 'approve', null, token()))).toMatchObject({ code: 'WORKFLOW_STATE_INVALID' });
    expect(await orchestrator.signal(fresh.id, 'sign-off', null, token())).toMatchObject({ state: 'APPROVED', version: 2 });
  });

  it('keeps its own copy of a registered definition: editing the caller object afterwards changes no instance', async () => {
    const { definition } = approval(1);
    const orchestrator = orchestratorWith(definition);
    const started = await orchestrator.start('approval', null, token());
    // The caller prepares the next version by editing the object it registered.
    (definition.transitions[0] as { to: string }).to = 'REJECTED';
    (definition.transitions as unknown[]).pop();
    (definition.terminalStates as string[]).length = 0;
    expect(await orchestrator.signal(started.id, 'approve', null, token())).toMatchObject({ state: 'APPROVED', status: 'COMPLETED', version: 1 });
    // The reject edge still exists in the registered version (the pop removed it from the caller's list only).
    const second = await orchestrator.start('approval', null, token());
    expect(await orchestrator.signal(second.id, 'reject', 'allowed', token())).toMatchObject({ state: 'REJECTED', status: 'COMPLETED' });
  });

  it('refuses a version that is not newer than the registered ones, and an invalid definition', () => {
    const orchestrator = orchestratorWith(approval(2).definition);
    expect(() => orchestrator.register(approval(2).definition)).toThrow(expect.objectContaining({ code: 'WORKFLOW_DEFINITION_INVALID' }));
    expect(() => orchestrator.register(approval(1).definition)).toThrow(expect.objectContaining({ code: 'WORKFLOW_DEFINITION_INVALID' }));
    expect(() => orchestrator.register({ ...approval(3).definition, terminalStates: [] })).toThrow(expect.objectContaining({ code: 'WORKFLOW_DEFINITION_INVALID' }));
  });

  it('uses a supplied id generator', async () => {
    const orchestrator = new InProcessOrchestrator({ verify: (signed) => verifyTenantContext(signed, KEY), newId: () => 'fixed-id' });
    orchestrator.register(approval().definition);
    expect((await orchestrator.start('approval', null, token())).id).toBe('fixed-id');
  });
});
