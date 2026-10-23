import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ReadOnlyModeGuard } from '../session/read-only-mode.guard';
import { TENANT_RUNTIME } from '../session/tenant-runtime';
import type { TenantRuntimeSource } from '../session/tenant-runtime';
import { AUTH_OPTIONS, AuthGuard } from './auth.guard';
import type { AuthGuardOptions } from './auth.guard';

/**
 * Registers the authentication guard for every route of the application. Import it before PolicyModule, so that
 * the guard that sets the Principal runs first.
 */
@Module({})
export class AuthModule {
  /** `tenantRuntime`: the live state of tenants, so a suspension reaches sessions issued before it (see ReadOnlyModeGuard). */
  static register(options: AuthGuardOptions, tenantRuntime?: TenantRuntimeSource): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        { provide: AUTH_OPTIONS, useValue: options },
        ...(tenantRuntime === undefined ? [] : [{ provide: TENANT_RUNTIME, useValue: tenantRuntime }]),
        { provide: APP_GUARD, useClass: AuthGuard },
        // A session of a suspended tenant may read and export only; it runs right after the token is authenticated.
        { provide: APP_GUARD, useClass: ReadOnlyModeGuard },
      ],
    };
  }
}
