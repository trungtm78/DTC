import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { AuditWriter, IdempotencyStore, TenantDatabase } from '@machvon/db';
import type { ControlDatabase, UserSessionStore } from '@machvon/db';
import type { MetricsSink } from '@machvon/kernel';
import type { TenantTokenIssuer } from '../auth/tenant-token-issuer';
import type { TokenVerifier } from '../auth/token-verifier';
import { IDENTITY_OPTIONS, IdentityGuard } from './identity.guard';
import { SelectTenantController } from './select-tenant.controller';
import { SelectTenantService } from './select-tenant.service';
import type { UserSessionDenyList } from './user-session-deny-list';

export interface SessionModuleOptions {
  verifier: TokenVerifier;
  control: ControlDatabase;
  tenants: TenantDatabase;
  sessions: UserSessionStore;
  issuer: TenantTokenIssuer;
  /** The deny-list the authentication guard also consults: a tenant switch revokes in it at once. */
  denyList: UserSessionDenyList;
  metrics?: MetricsSink;
  now?: () => Date;
}

/** Tenant selection (IAM-003): the route a person uses between signing in and working. The membership reads live in AppModule. */
@Module({})
export class SessionModule {
  static register(options: SessionModuleOptions): DynamicModule {
    const service = new SelectTenantService({
      control: options.control,
      tenants: options.tenants,
      sessions: options.sessions,
      idempotency: new IdempotencyStore(options.tenants),
      audit: new AuditWriter(options.tenants),
      issuer: options.issuer,
      denyList: options.denyList,
      metrics: options.metrics,
      now: options.now,
    });
    return {
      module: SessionModule,
      controllers: [SelectTenantController],
      providers: [
        { provide: TenantDatabase, useValue: options.tenants },
        { provide: IDENTITY_OPTIONS, useValue: { verifier: options.verifier, control: options.control } },
        IdentityGuard,
        { provide: SelectTenantService, useValue: service },
      ],
    };
  }
}
