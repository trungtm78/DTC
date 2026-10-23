import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_OPTIONS, AuthGuard } from './auth.guard';
import type { AuthGuardOptions } from './auth.guard';

/**
 * Registers the authentication guard for every route of the application. Import it before PolicyModule, so that
 * the guard that sets the Principal runs first.
 */
@Module({})
export class AuthModule {
  static register(options: AuthGuardOptions): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        { provide: AUTH_OPTIONS, useValue: options },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
