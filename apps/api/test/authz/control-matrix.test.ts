import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_OPERATIONS, CONTROL_ROLE_NAMES, controlCasesFor } from './control-matrix';

const CONTROL_COMMANDS: readonly string[] = (
  JSON.parse(readFileSync(join(__dirname, 'matrix-commands.json'), 'utf8')) as { controlCommands: string[] }
).controlCommands;

describe('control-plane authorization matrix generator', () => {
  it('lists every control command of matrix-commands.json and no command that is missing there', () => {
    const commands = CONTROL_OPERATIONS.filter((operation) => operation.method === 'POST').map((operation) => operation.operationId);
    expect([...commands].sort()).toEqual([...CONTROL_COMMANDS].sort());
  });

  it('gives one case per operation and realm role, allowing exactly the roles whose permissions cover the operation', () => {
    const cases = controlCasesFor(CONTROL_OPERATIONS);
    expect(cases).toHaveLength(CONTROL_OPERATIONS.length * CONTROL_ROLE_NAMES.length);
    expect(new Set(cases.map((matrixCase) => matrixCase.id)).size).toBe(cases.length);
    const verdict = (operationId: string): Record<string, string> =>
      Object.fromEntries(cases.filter((matrixCase) => matrixCase.operationId === operationId).map((matrixCase) => [matrixCase.role, matrixCase.expected]));
    expect(verdict('requestTenantProvisioning')).toEqual({ SystemAdmin: 'allow', PlatformOperator: 'deny', BillingOperator: 'deny', SupportOperator: 'deny' });
    expect(verdict('retryTenantProvisioning')).toEqual(verdict('requestTenantProvisioning'));
    expect(verdict('listSystemTenants')).toEqual({ SystemAdmin: 'allow', PlatformOperator: 'allow', BillingOperator: 'allow', SupportOperator: 'deny' });
    expect(verdict('getSystemTenant')).toEqual(verdict('listSystemTenants'));
  });

  it('derives the permission from the generated table', () => {
    expect(CONTROL_OPERATIONS.map((operation) => operation.permission)).toEqual(['system.tenant.manage', 'system.tenant.manage', 'system.tenant.read', 'system.tenant.read']);
  });
});
