import { randomBytes, randomUUID } from 'node:crypto';
import type { Type } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TenantDatabase } from '@machvon/db';
import type { TestDatabase } from '@machvon/db/src/test-database';
import { loadErrorRegistry } from '@machvon/kernel';
import { Pool } from 'pg';
import { CommandModule } from '../src/command.module';
import { ProblemFilter } from '../src/problem.filter';
import { WIDGET_STATE, WidgetController } from './command-test-controller';
import type { WidgetState } from './command-test-controller';
import { tokenFor } from './isolation/channels/api';
import type { TenantName } from './isolation/suite';
import { ERROR_CODES_PATH, startIsolationDatabase, startTestApp } from './isolation/test-app';
import type { RunningApp } from './isolation/test-app';
import { TENANT_HEADER } from './isolation/test-auth.guard';

export interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: Record<string, unknown>;
}

export interface SendOptions {
  tenant?: TenantName;
  /** null sends no Idempotency-Key; undefined sends a fresh one. */
  key?: string | null;
  body?: unknown;
  ifMatch?: string;
  authenticated?: boolean;
  extraHeaders?: Record<string, string>;
}

export const newKey = (): string => `key-${randomUUID()}`;

/** A running API with the command pipeline, the sample widget commands and a real PostgreSQL behind it. */
export class CommandHarness {
  readonly state: WidgetState = { failing: false, executions: 0 };
  private readonly signingKey = randomBytes(32);
  private database: TestDatabase | undefined;
  private app: RunningApp | undefined;
  private appPool: Pool | undefined;
  private adminPool: Pool | undefined;

  get admin(): Pool {
    if (this.adminPool === undefined) throw new Error('harness not started');
    return this.adminPool;
  }

  /** The tenant plane the API runs on, for a test that drives a store directly (a purge) beside the HTTP calls. */
  get tenants(): TenantDatabase {
    if (this.appPool === undefined) throw new Error('harness not started');
    return new TenantDatabase(this.appPool);
  }

  async start(extraControllers: Type[] = []): Promise<void> {
    this.database = await startIsolationDatabase();
    this.adminPool = new Pool({ connectionString: this.database.adminUrl, max: 2 });
    await this.adminPool.query(
      'create table public.test_widget (tenant_id uuid not null, id uuid primary key, name text not null, version integer not null)',
    );
    await this.adminPool.query('grant select, insert, update, delete on public.test_widget to machvon_app');
    this.appPool = new Pool({ connectionString: this.database.urlFor('machvon_app'), max: 10 });
    this.app = await startTestApp({
      signingKey: this.signingKey,
      imports: [CommandModule.register({ database: new TenantDatabase(this.appPool) })],
      controllers: [WidgetController, ...extraControllers],
      providers: [
        { provide: WIDGET_STATE, useValue: this.state },
        { provide: APP_FILTER, useValue: new ProblemFilter(loadErrorRegistry(ERROR_CODES_PATH)) },
      ],
    });
  }

  async stop(): Promise<void> {
    if (this.app) await this.app.close();
    await Promise.all([this.appPool?.end(), this.adminPool?.end()]);
    if (this.database) await this.database.stop();
  }

  async send(method: string, path: string, options: SendOptions = {}): Promise<Reply> {
    if (this.app === undefined) throw new Error('harness not started');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.authenticated !== false) headers[TENANT_HEADER] = tokenFor(options.tenant ?? 'TNT-A', this.signingKey);
    if (options.key !== null) headers['idempotency-key'] = options.key ?? newKey();
    if (options.ifMatch !== undefined) headers['if-match'] = options.ifMatch;
    Object.assign(headers, options.extraHeaders);
    const response = await fetch(`${this.app.baseUrl}${path}`, { method, headers, body: JSON.stringify(options.body ?? { name: 'w' }) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, json: JSON.parse(text) as Record<string, unknown> };
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await this.admin.query<{ n: string }>(sql, params);
    return Number(rows[0]?.n);
  }
}
