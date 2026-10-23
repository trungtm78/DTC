import { Controller, Get, Req } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { PLATFORM_TENANT_ID } from '@machvon/db';
import { loadErrorRegistry } from '@machvon/kernel';
import { AuthModule } from '../../src/auth/auth.module';
import { AUTH_TOKEN_REQUEST_KEY } from '../../src/auth/auth.guard';
import { HttpJwksSource, discoverJwksUri } from '../../src/auth/jwks-source';
import { JwksTokenVerifier } from '../../src/auth/jwks-token-verifier';
import { OperationId } from '../../src/operation-id.decorator';
import { PRINCIPAL_REQUEST_KEY } from '../../src/principal';
import { ProblemFilter } from '../../src/problem.filter';
import { InMemorySessionDenyList } from '../../src/session-deny-list';
import { ERROR_CODES_PATH } from '../isolation/test-app';
import {
  CONTROL_AUDIENCE,
  IDENTITY_AUDIENCE,
  NOW,
  NOW_SECONDS,
  SESSION_ID,
  TENANT,
  TENANT_ISSUER,
  controlClaims,
  identityClaims,
  issuerKey,
  newIssuer,
  pick,
  tenantClaims,
} from './auth-fixtures';
import { OidcTestProvider, newKey, signJwt } from './oidc-test-provider';
import type { ProviderKey } from './oidc-test-provider';

// Key generation (RSA 2048) is slow on a loaded machine.
jest.setTimeout(30_000);

@Controller('who')
class WhoController {
  @Get()
  @OperationId('probe_who')
  who(@Req() request: Record<string, unknown>): unknown {
    return { principal: request[PRINCIPAL_REQUEST_KEY], authenticated: request[AUTH_TOKEN_REQUEST_KEY] };
  }
}

/** The authentication module wired to the real verifier, the real adapter and an in-process OIDC provider. */
describe('AuthModule with the OIDC adapter', () => {
  let provider: OidcTestProvider;
  let key: ProviderKey;
  let app: INestApplication;
  let baseUrl: string;
  const denyList = new InMemorySessionDenyList();
  const issuer = newIssuer(issuerKey());

  async function get(token: string | undefined): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}/who`, { headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    provider = await OidcTestProvider.start();
    key = provider.addKey('RS256');
    const jwksUri = await discoverJwksUri(provider.issuer);
    const verifier = new JwksTokenVerifier({
      issuer: provider.issuer,
      identityAudience: IDENTITY_AUDIENCE,
      controlAudience: CONTROL_AUDIENCE,
      jwks: new HttpJwksSource({ jwksUri, now: () => NOW }),
      tenantTokenKeys: async () => (await issuer.publicKeys()).keys,
      tenantIssuer: TENANT_ISSUER,
      now: () => NOW,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule.register({ verifier, denyList, controlAudience: CONTROL_AUDIENCE })],
      controllers: [WhoController],
      providers: [{ provide: APP_FILTER, useValue: new ProblemFilter(loadErrorRegistry(ERROR_CODES_PATH)) }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    await provider.stop();
  });

  it('accepts a tenant token issued by the tenant token issuer', async () => {
    const { accessToken } = await issuer.issue({ tenant: TENANT, sessionId: SESSION_ID, assurance: 'aal2', aal2At: new Date((NOW_SECONDS - 60) * 1000), mode: 'FULL', now: NOW });
    const reply = await get(accessToken);
    expect(reply.status).toBe(200);
    expect(reply.json.principal).toMatchObject({ tenant: TENANT, audience: 'tenant', assurance: 'aal2', sessionId: SESSION_ID });
  });

  it('accepts a control token of the identity provider and builds a control principal on the platform tenant', async () => {
    const reply = await get(signJwt(key, controlClaims(provider.issuer, { sid: 'sid-control' })));
    expect(reply.status).toBe(200);
    expect(reply.json.principal).toMatchObject({ audience: 'control', sessionId: 'sid-control', tenant: { tenantId: PLATFORM_TENANT_ID } });
    expect(pick(reply.json, 'authenticated', 'roles')).toEqual(['SystemAdmin']);
  });

  it.each([
    ['an identity token of the tenant client', () => signJwt(key, identityClaims(provider.issuer))],
    ['a control token signed by an unknown key', () => signJwt(newKey('RS256'), controlClaims(provider.issuer))],
    ['a tenant token signed by the identity provider key', () => signJwt(key, tenantClaims())],
    ['no token', () => undefined],
  ])('refuses %s with 401 SESSION_EXPIRED', async (_label, make) => {
    const reply = await get(make());
    expect(reply.status).toBe(401);
    expect(reply.json.code).toBe('SESSION_EXPIRED');
  });

  it('refuses a verified token whose session was revoked', async () => {
    const { accessToken } = await issuer.issue({ tenant: TENANT, sessionId: 'sid-revoked', assurance: 'aal1', mode: 'FULL', now: NOW });
    expect((await get(accessToken)).status).toBe(200);
    denyList.revoke('sid-revoked');
    expect((await get(accessToken)).status).toBe(401);
  });
});
