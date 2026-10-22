import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TenantDatabase } from '@machvon/db';
import type { RegisteredError } from '@machvon/kernel';
import { OrganizationUnitsController } from './organization-units.controller';
import { ProblemFilter } from './problem.filter';

export interface AppModuleOptions {
  database: TenantDatabase;
  registry: ReadonlyMap<string, RegisteredError>;
}

/**
 * The API shell. It registers no authentication: the host adds a guard that sets the verified
 * TenantContext on the request (tests use TestAuthGuard; real authentication arrives with ST-IAM-002).
 * Without one, every tenant-scoped request fails with TENANT_CONTEXT_INVALID.
 */
@Module({})
export class AppModule {
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [OrganizationUnitsController],
      providers: [
        { provide: TenantDatabase, useValue: options.database },
        { provide: APP_FILTER, useValue: new ProblemFilter(options.registry) },
      ],
    };
  }
}
