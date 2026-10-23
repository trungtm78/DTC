import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { loadErrorRegistry } from '@machvon/kernel';
import type { EffectiveAccessStore, TenantDatabase } from '@machvon/db';
import { AuthModule } from '../../src/auth/auth.module';
import { OperationId } from '../../src/operation-id.decorator';
import { PolicyModule } from '../../src/policy.module';
import { ProblemFilter } from '../../src/problem.filter';
import { InMemorySessionDenyList } from '../../src/session-deny-list';
import { ERROR_CODES_PATH } from '../isolation/test-app';
import { SESSION_ID, SUBJECT, TENANT, NOW } from './auth-fixtures';
import { FakeTokenVerifier } from './fake-token-verifier';

const SYSTEM_ADMIN = 'system-admin-token';
const BILLING_OPERATOR = 'billing-operator-token';
const NO_ROLES = 'no-roles-token';
const TENANT_TOKEN = 'tenant-token';

@Controller('probe')
class ProbeController {
  @Get('control')
  @OperationId('probe_control_read')
  control(): { ok: true } {
    return { ok: true };
  }
}

/**
 * The real AuthGuard and the real PolicyGuard together: a control-plane operation is judged on the realm roles of the
 * token (controlAccessOf), and the tenant-plane access store must never be asked for a control principal.
 */
describe('control-plane operations behind the real AuthGuard and PolicyGuard', () => {
  const verifier = new FakeTokenVerifier();
  const loaded: string[] = [];
  const access = {
    load(ctx: { tenantId: string }): Promise<never> {
      loaded.push(ctx.tenantId);
      return Promise.reject(new Error('the tenant access store must not be asked for a control principal'));
    },
  } as unknown as EffectiveAccessStore;
  let app: INestApplication;
  let baseUrl: string;

  async function get(token: string): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}/probe/control`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    verifier.registerIdentity(SYSTEM_ADMIN, { subject: SUBJECT, sessionId: 'sid-admin', assurance: 'aal2', aal2At: NOW, audience: 'control-client', roles: ['SystemAdmin'] });
    verifier.registerIdentity(BILLING_OPERATOR, { subject: SUBJECT, sessionId: 'sid-billing', assurance: 'aal2', aal2At: NOW, audience: 'control-client', roles: ['BillingOperator'] });
    verifier.registerIdentity(NO_ROLES, { subject: SUBJECT, sessionId: 'sid-none', assurance: 'aal2', aal2At: NOW, audience: 'control-client', roles: [] });
    verifier.registerTenant(TENANT_TOKEN, { tenant: TENANT, sessionId: SESSION_ID, assurance: 'aal2', aal2At: NOW, audience: 'tenant', mode: 'FULL', roles: [], expiresAt: NOW });
    const audienceOf = (token: string): string[] => (token === TENANT_TOKEN ? ['machvon-api'] : ['machvon-control']);
    const denyList = new InMemorySessionDenyList();
    const moduleRef = await Test.createTestingModule({
      imports: [
        AuthModule.register({ verifier, denyList, controlAudience: 'machvon-control', audienceOf }),
        PolicyModule.register({
          database: {} as unknown as TenantDatabase,
          access,
          denyList,
          now: () => NOW,
          extraOperations: { probe_control_read: { permission: 'system.tenant.read', plane: 'control' } },
        }),
      ],
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useValue: new ProblemFilter(loadErrorRegistry(ERROR_CODES_PATH)) }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets a SystemAdmin token through on the strength of its realm role, without touching tenant grants', async () => {
    const reply = await get(SYSTEM_ADMIN);
    expect(reply.status).toBe(200);
    expect(loaded).toEqual([]);
  });

  it('lets a role that holds the permission through and refuses a role that does not (SCOPE_DENIED)', async () => {
    expect((await get(BILLING_OPERATOR)).status).toBe(200);
    const refused = await get(NO_ROLES);
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('SCOPE_DENIED');
    expect(loaded).toEqual([]);
  });

  it('refuses a tenant token on a control operation with SCOPE_DENIED (the audience differs)', async () => {
    const reply = await get(TENANT_TOKEN);
    expect(reply.status).toBe(403);
    expect(reply.json.code).toBe('SCOPE_DENIED');
  });
});
