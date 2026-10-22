import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Module } from '@nestjs/common';
import type { DynamicModule, INestApplication, Provider, Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { OpenApiDocument } from '@machvon/contracts';
import { SCHEMA_SOURCE_PATH, generateMigrations } from '@machvon/db/src/generate-migrations';
import { migrate } from '@machvon/db/src/migrate';
import { startTestDatabase } from '@machvon/db/src/test-database';
import type { TestDatabase } from '@machvon/db/src/test-database';
import { TEST_SIGNING_KEY, TestAuthGuard } from './test-auth.guard';

export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ENGINEERING_DIR = join(REPO_ROOT, 'Design', 'MACHVON_Design', '03_Engineering');
export const OPENAPI_PATH = join(ENGINEERING_DIR, 'openapi.json');
export const ERROR_CODES_PATH = join(ENGINEERING_DIR, 'error_codes.json');
export const FIXTURES_PATH = join(ENGINEERING_DIR, 'test_fixtures.json');

export function loadOpenApi(): OpenApiDocument {
  return JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenApiDocument;
}

/** Starts embedded PostgreSQL and applies the generated test-profile migrations. Stop it in afterAll. */
export async function startIsolationDatabase(): Promise<TestDatabase> {
  const database = await startTestDatabase();
  try {
    const schema = readFileSync(join(REPO_ROOT, SCHEMA_SOURCE_PATH), 'utf8');
    await migrate(database.adminUrl, generateMigrations(schema), { profile: 'test' });
    return database;
  } catch (error) {
    await database.stop();
    throw error;
  }
}

export interface TestAppOptions {
  signingKey: Buffer;
  imports?: DynamicModule[];
  controllers?: Type[];
  providers?: Provider[];
}

export interface RunningApp {
  baseUrl: string;
  close(): Promise<void>;
}

@Module({})
class IsolationTestModule {}

/** A Nest app whose only authentication is TestAuthGuard; it listens on a free local port. */
export async function startTestApp(options: TestAppOptions): Promise<RunningApp> {
  const providers: Provider[] = [
    { provide: TEST_SIGNING_KEY, useValue: options.signingKey },
    { provide: APP_GUARD, useClass: TestAuthGuard },
    ...(options.providers ?? []),
  ];
  const moduleRef = await Test.createTestingModule({
    imports: [{ module: IsolationTestModule, imports: options.imports ?? [], controllers: options.controllers ?? [], providers }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => app.close() };
}
