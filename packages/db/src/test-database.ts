import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { MACHVON_ROLES } from './roles.ts';
import type { MachvonRole } from './roles.ts';

export { MACHVON_ROLES };
export type { MachvonRole };

export interface TestDatabase {
  adminUrl: string;
  urlFor(role: MachvonRole): string;
  stop(): Promise<void>;
}

const DATABASE_NAME = 'postgres';
const ADMIN_USER = 'postgres';

function randomPassword(): string {
  return randomBytes(24).toString('hex');
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close((closeError) => (closeError ? reject(closeError) : resolve(port)));
    });
  });
}

function connectionUrl(user: string, password: string, port: number): string {
  return `postgres://${user}:${password}@localhost:${port}/${DATABASE_NAME}`;
}

async function createRoles(adminUrl: string, passwords: Record<MachvonRole, string>): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const role of MACHVON_ROLES) {
      await client.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${passwords[role]}'`);
      await client.query(`GRANT CONNECT ON DATABASE ${DATABASE_NAME} TO ${role}`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Starts a real PostgreSQL server (UTF8, C locale) on a free port in a unique temporary
 * directory and creates the six MACHVON roles. Callers must stop it in a finally block or afterAll.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const workDir = await mkdtemp(join(tmpdir(), 'machvon-pg-'));
  const adminPassword = randomPassword();
  const passwords = Object.fromEntries(MACHVON_ROLES.map((role) => [role, randomPassword()])) as Record<
    MachvonRole,
    string
  >;
  let server: EmbeddedPostgres | undefined;
  let started = false;

  const stop = async (): Promise<void> => {
    try {
      if (server !== undefined && started) {
        started = false;
        await server.stop();
      }
    } finally {
      // Windows keeps files locked for a short moment after the process tree is killed.
      await rm(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  };

  try {
    const port = await findFreePort();
    server = new EmbeddedPostgres({
      databaseDir: join(workDir, 'data'),
      user: ADMIN_USER,
      password: adminPassword,
      port,
      // The harness removes the directory itself (with retries); the library delete races on Windows.
      persistent: true,
      onLog: () => undefined,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
    });
    await server.initialise();
    await server.start();
    started = true;
    const adminUrl = connectionUrl(ADMIN_USER, adminPassword, port);
    await createRoles(adminUrl, passwords);
    return {
      adminUrl,
      urlFor: (role) => connectionUrl(role, passwords[role], port),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
