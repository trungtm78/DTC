import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { TenantDatabase, TenantTx } from '@machvon/db';
import { loadErrorRegistry } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { AUTH_TOKEN_REQUEST_KEY } from '../../src/auth/auth.guard';
import type { AuthenticatedToken } from '../../src/auth/auth.guard';
import { OperationId } from '../../src/operation-id.decorator';
import { PRINCIPAL_REQUEST_KEY } from '../../src/principal';
import { ProblemFilter } from '../../src/problem.filter';
import { ReadOnlyModeGuard } from '../../src/session/read-only-mode.guard';
import { DatabaseTenantRuntime, TENANT_RUNTIME, runtimeVerdict } from '../../src/session/tenant-runtime';
import type { TenantRuntime, TenantRuntimeSource } from '../../src/session/tenant-runtime';
import { ERROR_CODES_PATH } from '../isolation/test-app';

const TENANT = '00000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-10-24T03:00:00Z');
const full: TenantRuntime = { status: 'Active', accessPolicy: 'FULL', writeFrozenUntil: null };
const readOnly: TenantRuntime = { status: 'Suspended', accessPolicy: 'READ_ONLY_EXPORT', writeFrozenUntil: null };
const noAccess: TenantRuntime = { status: 'Suspended', accessPolicy: 'NO_ACCESS', writeFrozenUntil: null };

describe('runtimeVerdict: what the state of a tenant allows a request to do (SAS 3.6, IAM 3.2)', () => {
  const verdict = (runtime: TenantRuntime | undefined, method: string, isExport = false) => {
    const error = runtimeVerdict(runtime, { method, isExport }, NOW);
    return error === undefined ? 'allow' : `${error.code}:${error.status}`;
  };

  it('allows everything for an Active tenant and for a tenant that has no row (fixtures)', () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) expect(verdict(full, method)).toBe('allow');
    expect(verdict(undefined, 'POST')).toBe('allow');
  });

  it('lets a read-only tenant read and export and refuses every other command with 403 TENANT_SUSPENDED', () => {
    expect(verdict(readOnly, 'GET')).toBe('allow');
    expect(verdict(readOnly, 'HEAD')).toBe('allow');
    expect(verdict(readOnly, 'POST', true)).toBe('allow');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(verdict(readOnly, method)).toBe('TENANT_SUSPENDED:403');
  });

  it('refuses every request, a read as well, when the access policy is NO_ACCESS', () => {
    for (const method of ['GET', 'POST']) expect(verdict(noAccess, method)).toBe('TENANT_SUSPENDED:403');
    expect(verdict(noAccess, 'POST', true)).toBe('TENANT_SUSPENDED:403');
  });

  it('refuses a command with 503 TENANT_WRITE_FROZEN while the write freeze runs, and lets reads through', () => {
    const frozen: TenantRuntime = { status: 'Active', accessPolicy: 'FULL', writeFrozenUntil: new Date(NOW.getTime() + 60_000) };
    expect(verdict(frozen, 'POST')).toBe('TENANT_WRITE_FROZEN:503');
    expect(verdict(frozen, 'GET')).toBe('allow');
    expect(verdict({ ...frozen, writeFrozenUntil: new Date(NOW.getTime()) }, 'POST')).toBe('allow');
    expect(verdict({ ...frozen, writeFrozenUntil: new Date(NOW.getTime() - 1) }, 'POST')).toBe('allow');
  });
});

describe('DatabaseTenantRuntime', () => {
  function source(rows: () => Array<{ status: string; access_policy: string; write_frozen_until: Date | null }>, maxAgeMs?: number) {
    const clock = { now: 1_000_000 };
    const seen: TenantContext[] = [];
    const queries = jest.fn(() => rows());
    const database = {
      withTenant: (ctx: TenantContext, work: (tx: TenantTx) => Promise<unknown>) => {
        seen.push(ctx);
        return work({ query: queries } as unknown as TenantTx);
      },
    } as unknown as TenantDatabase;
    return { runtime: new DatabaseTenantRuntime(database, { ...(maxAgeMs === undefined ? {} : { maxAgeMs }), now: () => clock.now }), clock, queries, seen };
  }

  it('reads the state of the tenant of the request through its own transaction and answers it', async () => {
    const { runtime, seen } = source(() => [{ status: 'Suspended', access_policy: 'READ_ONLY_EXPORT', write_frozen_until: null }]);
    expect(await runtime.of(TENANT)).toEqual(readOnly);
    expect(seen[0]).toMatchObject({ tenantId: TENANT, scopeVersion: 0 });
  });

  it('answers undefined for a tenant with no row and keeps an unknown policy from widening access', async () => {
    expect(await source(() => []).runtime.of(TENANT)).toBeUndefined();
    const odd = await source(() => [{ status: 'Active', access_policy: 'WHATEVER', write_frozen_until: null }]).runtime.of(TENANT);
    expect(odd?.accessPolicy).toBe('NO_ACCESS');
  });

  it('serves a repeat from memory for the maximum age, then reads again', async () => {
    const { runtime, clock, queries } = source(() => [{ status: 'Active', access_policy: 'FULL', write_frozen_until: null }], 1000);
    await runtime.of(TENANT);
    clock.now += 999;
    await runtime.of(TENANT);
    expect(queries).toHaveBeenCalledTimes(1);
    clock.now += 2;
    await runtime.of(TENANT);
    expect(queries).toHaveBeenCalledTimes(2);
  });

  it('forgets a tenant at once when told it changed, so a suspension takes effect on the very next request', async () => {
    let rows = [{ status: 'Active', access_policy: 'FULL', write_frozen_until: null as Date | null }];
    const { runtime } = source(() => rows, 60_000);
    expect((await runtime.of(TENANT))?.accessPolicy).toBe('FULL');
    rows = [{ status: 'Suspended', access_policy: 'READ_ONLY_EXPORT', write_frozen_until: null }];
    expect((await runtime.of(TENANT))?.accessPolicy).toBe('FULL');
    runtime.invalidate(TENANT);
    expect((await runtime.of(TENANT))?.accessPolicy).toBe('READ_ONLY_EXPORT');
  });

  it('does not keep a failed read: the next request asks again', async () => {
    let fail = true;
    const { runtime } = source(() => {
      if (fail) throw new Error('database down');
      return [{ status: 'Active', access_policy: 'FULL', write_frozen_until: null }];
    }, 60_000);
    await expect(runtime.of(TENANT)).rejects.toThrow('database down');
    fail = false;
    expect(await runtime.of(TENANT)).toEqual(full);
  });
});

@Controller('runtime')
class RuntimeController {
  @Get('read')
  @OperationId('probe_read')
  read(): { ok: true } {
    return { ok: true };
  }

  @Post('write')
  @HttpCode(200)
  @OperationId('probe_write')
  write(): { ok: true } {
    return { ok: true };
  }

  @Post('export')
  @HttpCode(200)
  @OperationId('createReportExport')
  exportReport(): { ok: true } {
    return { ok: true };
  }
}

/** Stands in for the authentication guard: a full tenant token and the principal of a tenant or a control caller. */
class FakeAuthentication {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; [key: string]: unknown }>();
    const audience = request.headers['x-audience'] ?? 'tenant';
    const token: AuthenticatedToken = { audience: audience as 'tenant' | 'control', roles: [], mode: 'FULL' };
    request[AUTH_TOKEN_REQUEST_KEY] = token;
    request[PRINCIPAL_REQUEST_KEY] = { tenant: { tenantId: TENANT, membershipId: TENANT, scopeVersion: 0 }, audience, assurance: 'aal1', sessionId: 's' };
    return true;
  }
}

describe('ReadOnlyModeGuard with the live state of the tenant', () => {
  let app: INestApplication;
  let baseUrl: string;
  let current: TenantRuntime | undefined = full;
  const asked: string[] = [];
  const runtime: TenantRuntimeSource = {
    of: (tenantId) => {
      asked.push(tenantId);
      return Promise.resolve(current);
    },
    invalidate: () => undefined,
  };

  const call = async (method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RuntimeController],
      providers: [
        { provide: APP_GUARD, useClass: FakeAuthentication },
        { provide: APP_GUARD, useClass: ReadOnlyModeGuard },
        { provide: Reflector, useValue: new Reflector() },
        { provide: TENANT_RUNTIME, useValue: runtime },
        { provide: APP_FILTER, useValue: new ProblemFilter(loadErrorRegistry(ERROR_CODES_PATH)) },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    current = full;
    asked.length = 0;
  });

  it('refuses a command at once, with a token issued while the tenant was Active, once the tenant is Suspended', async () => {
    expect((await call('POST', '/runtime/write')).status).toBe(200);
    current = readOnly;
    const reply = await call('POST', '/runtime/write');
    expect(reply.status).toBe(403);
    expect(reply.json.code).toBe('TENANT_SUSPENDED');
    expect((await call('GET', '/runtime/read')).status).toBe(200);
    expect((await call('POST', '/runtime/export')).status).toBe(200);
  });

  it('refuses even a read when the tenant is suspended for a security incident', async () => {
    current = noAccess;
    expect((await call('GET', '/runtime/read')).json.code).toBe('TENANT_SUSPENDED');
  });

  it('answers 503 TENANT_WRITE_FROZEN while a placement cutover freezes writes', async () => {
    current = { status: 'Active', accessPolicy: 'FULL', writeFrozenUntil: new Date(Date.now() + 60_000) };
    const reply = await call('POST', '/runtime/write');
    expect(reply.status).toBe(503);
    expect(reply.json.code).toBe('TENANT_WRITE_FROZEN');
  });

  it('asks about the tenant of the principal, and never for a control-plane caller', async () => {
    await call('GET', '/runtime/read');
    expect(asked).toEqual([TENANT]);
    asked.length = 0;
    current = noAccess;
    expect((await call('GET', '/runtime/read', { 'x-audience': 'control' })).status).toBe(200);
    expect(asked).toEqual([]);
  });

  it('judges nothing without a runtime source (the token mode alone decides)', async () => {
    const guard = new ReadOnlyModeGuard(new Reflector());
    const context = {
      getHandler: () => RuntimeController.prototype.write,
      getClass: () => RuntimeController,
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', [AUTH_TOKEN_REQUEST_KEY]: { audience: 'tenant', roles: [], mode: 'FULL' } }) }),
    } as unknown as ExecutionContext;
    expect(await guard.canActivate(context)).toBe(true);
  });
});
