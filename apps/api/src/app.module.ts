import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TenantDatabase } from '@machvon/db';
import type { RegisteredError } from '@machvon/kernel';
import { CommandModule } from './command.module';
import { OrganizationUnitsController } from './organization-units.controller';
import { OrgUnitCommandsController } from './org-units.commands.controller';
import { PolicyModule } from './policy.module';
import type { PolicyModuleOptions } from './policy.module';
import { ProblemFilter } from './problem.filter';
import { RoleDefinitionsController } from './role-definitions.controller';
import { RoleGrantReadsController, RoleGrantsController } from './role-grants.controller';
import { RolesController } from './roles.controller';

export interface AppModuleOptions {
  database: TenantDatabase;
  registry: ReadonlyMap<string, RegisteredError>;
  /** Enables the policy decision point for every route; omit it only where authorisation is tested separately. */
  policy?: PolicyModuleOptions;
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
      imports: [CommandModule.register({ database: options.database }), ...(options.policy === undefined ? [] : [PolicyModule.register(options.policy)])],
      controllers: [
        OrganizationUnitsController,
        OrgUnitCommandsController,
        RolesController,
        RoleGrantsController,
        RoleGrantReadsController,
        RoleDefinitionsController,
      ],
      providers: [
        { provide: TenantDatabase, useValue: options.database },
        { provide: APP_FILTER, useValue: new ProblemFilter(options.registry) },
      ],
    };
  }
}
