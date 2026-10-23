import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AuthGuard } from '../../src/auth/auth.guard';
import { FakeTokenVerifier } from '../auth/fake-token-verifier';
import { NOW, SESSION_ID, SUBJECT, TENANT } from '../auth/auth-fixtures';

function contextFor(token: string): ExecutionContext {
  const request = { headers: { authorization: `Bearer ${token}` } };
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard and the tenant of a session', () => {
  const verifier = new FakeTokenVerifier();
  verifier.registerTenant('tenant-token', { tenant: TENANT, sessionId: SESSION_ID, assurance: 'aal2', aal2At: NOW, audience: 'tenant', mode: 'FULL', roles: [], expiresAt: NOW });
  verifier.registerIdentity('control-token', { subject: SUBJECT, sessionId: 'sid-control', assurance: 'aal2', aal2At: NOW, audience: 'control-client', roles: ['SystemAdmin'] });
  const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;

  it('tells the deny-list the tenant of a tenant token, so a per-tenant store can look the session up', async () => {
    const asked: Array<[string, string | undefined]> = [];
    const denyList = { isRevoked: (sessionId: string, tenantId?: string) => (asked.push([sessionId, tenantId]), Promise.resolve(false)) };
    const guard = new AuthGuard({ verifier, denyList, controlAudience: 'machvon-control', audienceOf: () => ['machvon-api'] }, reflector);
    await guard.canActivate(contextFor('tenant-token'));
    expect(asked).toEqual([[SESSION_ID, TENANT.tenantId]]);
  });

  it('gives no tenant for a control token: its session belongs to the identity provider', async () => {
    const asked: Array<[string, string | undefined]> = [];
    const denyList = { isRevoked: (sessionId: string, tenantId?: string) => (asked.push([sessionId, tenantId]), Promise.resolve(false)) };
    const guard = new AuthGuard({ verifier, denyList, controlAudience: 'machvon-control', audienceOf: () => ['machvon-control'] }, reflector);
    await guard.canActivate(contextFor('control-token'));
    expect(asked).toEqual([['sid-control', undefined]]);
  });
});
