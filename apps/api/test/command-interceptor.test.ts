import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuditWriter, IdempotencyStore, TenantDatabase, TenantTx } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import { of } from 'rxjs';
import { CommandInterceptor } from '../src/command.interceptor';
import { OperationId } from '../src/operation-id.decorator';

class Routes {
  @OperationId('createCustomRole')
  createRole(): void {}
}

const TENANT = '00000000-0000-4000-8000-00000000000a';
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';

function harness(claimed: boolean, options: { handler?: unknown; body?: unknown } = {}) {
  const finish = jest.fn().mockResolvedValue(undefined);
  const store = {
    begin: jest.fn().mockResolvedValue({ kind: 'started', recordId: 'record-1' }),
    claimInTx: jest.fn().mockResolvedValue(claimed),
    completeInTx: jest.fn().mockResolvedValue(undefined),
    finishOutsideTx: finish,
  } as unknown as IdempotencyStore;
  const database = { withTenant: (_ctx: unknown, work: (tx: TenantTx) => Promise<unknown>) => work({ query: jest.fn() }) } as unknown as TenantDatabase;
  const reflector = { get: () => ({ operation: 'createWidget' }) } as unknown as Reflector;
  const handle = jest.fn(() => of({ ok: true }));
  const next: CallHandler = { handle };
  const request = {
    method: 'POST',
    headers: { 'idempotency-key': 'key-0123456789abcdef' },
    params: {},
    body: 'body' in options ? options.body : { name: 'w' },
    tenantContext: { tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: 1 },
  };
  const context = {
    getHandler: () => options.handler,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader: jest.fn() }) }),
  } as unknown as ExecutionContext;
  const interceptor = new CommandInterceptor(reflector, database, store, {} as AuditWriter);
  return { interceptor, context, next, handle, finish, store };
}

describe('CommandInterceptor ownership of the idempotency record', () => {
  it('runs the handler and lets the owner settle the record as retryable when the command fails', async () => {
    const { interceptor, context, next, handle, finish } = harness(true);
    await expect(new Promise((resolve, reject) => interceptor.intercept(context, next).subscribe({ next: resolve, error: reject }))).rejects.toThrow('wrote no audit entry');
    expect(handle).toHaveBeenCalledTimes(1);
    // The failure is a plain error (no audit entry), so the record is settled as retryable by its owner.
    expect(finish).toHaveBeenCalledWith(expect.anything(), 'record-1', { retryable: true });
  });

  it('answers 409 IDEMPOTENCY_IN_PROGRESS without running the handler or settling the record when the claim is lost', async () => {
    const { interceptor, context, next, handle, finish } = harness(false);
    const failure = await new Promise<unknown>((resolve) => interceptor.intercept(context, next).subscribe({ next: resolve, error: resolve }));
    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 });
    expect(handle).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it('validates the body against the schema of its operation before anything is stored', async () => {
    const handler = Routes.prototype.createRole;
    for (const [body, code] of [
      [{ name: 'Clerk', permissions: ['iam.unit.manage'], rank: 35, code: 'UNIT_CLERK', is_system: true }, 'FIELD_NOT_ALLOWED'],
      [{ name: 'Clerk' }, 'INVALID_REQUEST'],
      [{ name: 'Clerk', permissions: ['iam.unit.manage'], rank: 95, code: 'UNIT_CLERK' }, 'INVALID_REQUEST'],
    ] as const) {
      const { interceptor, context, next, handle, store, finish } = harness(true, { handler, body });
      const failure = await new Promise<unknown>((resolve) => interceptor.intercept(context, next).subscribe({ next: resolve, error: resolve }));
      expect(failure).toMatchObject({ code, status: 400 });
      expect(store.begin).not.toHaveBeenCalled();
      expect(handle).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    }
  });

  it('lets a valid body of a real operation through to the handler', async () => {
    const handler = Routes.prototype.createRole;
    const body = { code: 'UNIT_CLERK', name: 'Clerk', permissions: ['iam.unit.manage'], rank: 35 };
    const { interceptor, context, next, handle, store } = harness(true, { handler, body });
    await new Promise<unknown>((resolve) => interceptor.intercept(context, next).subscribe({ next: resolve, error: resolve }));
    expect(store.begin).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
