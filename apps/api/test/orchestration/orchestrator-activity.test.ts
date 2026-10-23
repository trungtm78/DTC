import { randomBytes } from 'node:crypto';
import { DomainError, signTenantContext, verifyTenantContext } from '@machvon/kernel';
import type { SignalRequest, WorkflowDefinition } from '@machvon/kernel';
import { InProcessOrchestrator } from '../../src/modules/orchestration/in-process-orchestrator';
import { AuthzHarness, TENANT_A, TENANT_B, memberId, unitId } from '../../../../packages/db/test/support/authz-fixtures';

const KEY = randomBytes(32);

const token = (tenantId: string): string => signTenantContext({ tenantId, membershipId: memberId(1), scopeVersion: 1 }, KEY);

/** Forges a token for another tenant by swapping the tenant in the payload and keeping the signature. */
function tamper(signed: string, tenantId: string): string {
  const [payload, signature] = signed.split('.');
  const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  return `${Buffer.from(JSON.stringify({ ...decoded, tenantId }), 'utf8').toString('base64url')}.${signature}`;
}

describe('orchestration activities write through the tenant context (KERNEL-005, KERNEL-044)', () => {
  const harness = new AuthzHarness();

  beforeAll(async () => {
    await harness.start();
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  const unitCount = async (tenantId: string): Promise<number> =>
    Number((await harness.owner<{ n: string }>(tenantId, [['select count(*)::int as n from machvon.organization_unit']]))[0]?.n);

  /** An activity that creates an organisation unit for the tenant of the verified context, in its own transaction. */
  function createUnit(failAfterWrite: boolean): WorkflowDefinition {
    const activity = async (request: SignalRequest): Promise<void> => {
      await harness.tenants.withTenant(request.context, async (tx) => {
        await tx.query(
          `insert into machvon.organization_unit (tenant_id, id, code, name, valid_from, path, depth)
           values ($1, $2, 'ORC', 'Orchestrated', date '2026-01-01', $3, 0)`,
          [request.context.tenantId, unitId(900), `/${unitId(900)}/`],
        );
        if (failAfterWrite) throw new Error('activity failed after the write');
      });
    };
    return {
      name: failAfterWrite ? 'create-unit-failing' : 'create-unit',
      version: 1,
      initialState: 'WAITING',
      terminalStates: ['DONE'],
      transitions: [{ from: 'WAITING', signal: 'create', to: 'DONE', activity, guard: (request) => request.payload !== 'denied' }],
    };
  }

  function orchestrator(...definitions: WorkflowDefinition[]): InProcessOrchestrator {
    const instance = new InProcessOrchestrator({ verify: (signed) => verifyTenantContext(signed, KEY) });
    for (const definition of definitions) instance.register(definition);
    return instance;
  }

  it('writes one row for the tenant of the verified context and none for another tenant', async () => {
    const engine = orchestrator(createUnit(false));
    const { id } = await engine.start('create-unit', null, token(TENANT_A));
    expect(await engine.signal(id, 'create', null, token(TENANT_A))).toMatchObject({ state: 'DONE', status: 'COMPLETED' });
    expect(await unitCount(TENANT_A)).toBe(1);
    expect(await unitCount(TENANT_B)).toBe(0);
  });

  it('writes zero rows when the tenant in the context was modified', async () => {
    const before = await unitCount(TENANT_B);
    const engine = orchestrator(createUnit(false));
    const { id } = await engine.start('create-unit', null, token(TENANT_A));
    const forged = tamper(token(TENANT_A), TENANT_B);
    await expect(engine.signal(id, 'create', null, forged)).rejects.toMatchObject({ code: 'TENANT_CONTEXT_INVALID' });
    expect(await unitCount(TENANT_B)).toBe(before);
    expect(await engine.describe(id, token(TENANT_A))).toMatchObject({ state: 'WAITING' });
  });

  it('writes zero rows when the guard refuses the signal, and keeps waiting', async () => {
    const before = await unitCount(TENANT_B);
    const engine = orchestrator(createUnit(false));
    const { id } = await engine.start('create-unit', null, token(TENANT_B));
    await expect(engine.signal(id, 'create', 'denied', token(TENANT_B))).rejects.toBeInstanceOf(DomainError);
    expect(await unitCount(TENANT_B)).toBe(before);
    expect(await engine.describe(id, token(TENANT_B))).toMatchObject({ state: 'WAITING' });
  });

  it('rolls the row back and keeps waiting when the activity fails after its write', async () => {
    const before = await unitCount(TENANT_B);
    const engine = orchestrator(createUnit(true));
    const { id } = await engine.start('create-unit-failing', null, token(TENANT_B));
    await expect(engine.signal(id, 'create', null, token(TENANT_B))).rejects.toThrow('activity failed after the write');
    expect(await unitCount(TENANT_B)).toBe(before);
    expect(await engine.describe(id, token(TENANT_B))).toMatchObject({ state: 'WAITING' });
  });
});
