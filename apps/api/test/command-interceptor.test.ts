import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuditWriter, IdempotencyStore, TenantDatabase, TenantTx } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import { of } from 'rxjs';
import { CommandInterceptor } from '../src/command.interceptor';

const TENANT = '00000000-0000-4000-8000-00000000000a';
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';

function harness(claimed: boolean) {
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
    body: { name: 'w' },
    tenantContext: { tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: 1 },
  };
  const context = {
    getHandler: () => undefined,
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
});
