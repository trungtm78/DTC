import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { FactoryProvider } from '@nestjs/common';
import type { TenantDatabase } from '@machvon/db';
import { signTenantContext } from '@machvon/kernel';
import type { OrchestratorPort, WorkflowDefinition } from '@machvon/kernel';
import { AppModule } from '../../src/app.module';
import type { AppModuleOptions } from '../../src/app.module';
import { ORCHESTRATION_OPTIONS, ORCHESTRATOR, orchestrationModule } from '../../src/modules/orchestration';
import { MODULES } from '../../src/modules/registry';

const KEY = randomBytes(32);
const BASE = { database: {} as TenantDatabase, registry: new Map() } as AppModuleOptions;
const DEFINITION: WorkflowDefinition = {
  name: 'ping',
  version: 1,
  initialState: 'WAITING',
  terminalStates: ['DONE'],
  transitions: [{ from: 'WAITING', signal: 'pong', to: 'DONE' }],
};
const CONTEXT = { tenantId: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', membershipId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', scopeVersion: 1 };

describe('orchestration module', () => {
  it('is registered and active only where orchestration options are given', () => {
    expect(MODULES).toContain(orchestrationModule);
    expect(orchestrationModule.enabled?.(BASE)).toBe(false);
    expect(orchestrationModule.enabled?.({ ...BASE, orchestration: { contextKey: KEY } })).toBe(true);
    const tokens = (AppModule.register(BASE).providers ?? []).map((provider) => (provider as { provide?: unknown }).provide);
    expect(tokens).not.toContain(ORCHESTRATOR);
    expect(tokens).not.toContain(ORCHESTRATION_OPTIONS);
  });

  it('provides the port built from the options, with the definitions registered', async () => {
    const options = { ...BASE, orchestration: { contextKey: KEY, definitions: [DEFINITION] } };
    const providers = AppModule.register(options).providers ?? [];
    const optionsProvider = providers.find((provider) => (provider as { provide?: unknown }).provide === ORCHESTRATION_OPTIONS) as { useValue: unknown };
    const portProvider = providers.find((provider) => (provider as { provide?: unknown }).provide === ORCHESTRATOR) as FactoryProvider<OrchestratorPort>;
    expect(optionsProvider.useValue).toBe(options.orchestration);
    expect(portProvider.inject).toEqual([ORCHESTRATION_OPTIONS]);
    const port = await portProvider.useFactory(optionsProvider.useValue);
    const signed = signTenantContext(CONTEXT, KEY);
    const { id } = await port.start('ping', null, signed);
    expect(await port.signal(id, 'pong', null, signed)).toMatchObject({ state: 'DONE', status: 'COMPLETED' });
  });

  it('starts with no workflow when the options list none', async () => {
    const portProvider = (AppModule.register({ ...BASE, orchestration: { contextKey: KEY } }).providers ?? []).find(
      (provider) => (provider as { provide?: unknown }).provide === ORCHESTRATOR,
    ) as FactoryProvider<OrchestratorPort>;
    const port = await portProvider.useFactory({ contextKey: KEY });
    await expect(port.start('ping', null, signTenantContext(CONTEXT, KEY))).rejects.toMatchObject({ code: 'WORKFLOW_NOT_CONFIGURED' });
  });
});
