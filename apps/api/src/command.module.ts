import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditWriter, ControlDatabase, IdempotencyStore, TenantDatabase } from '@machvon/db';
import { CommandInterceptor } from './command.interceptor';

export interface CommandModuleOptions {
  database: TenantDatabase;
  /** Needed by commands declared with `plane: 'control'`. */
  control?: ControlDatabase;
}

/** Registers the command pipeline for every @Command handler of the application. */
@Module({})
export class CommandModule {
  static register(options: CommandModuleOptions): DynamicModule {
    return {
      module: CommandModule,
      providers: [
        { provide: TenantDatabase, useValue: options.database },
        ...(options.control === undefined ? [] : [{ provide: ControlDatabase, useValue: options.control }]),
        { provide: IdempotencyStore, useValue: new IdempotencyStore(options.database) },
        { provide: AuditWriter, useValue: new AuditWriter(options.database) },
        { provide: APP_INTERCEPTOR, useClass: CommandInterceptor },
      ],
    };
  }
}
