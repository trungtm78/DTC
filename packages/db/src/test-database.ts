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

export type RoleProvisioner = (adminUrl: string, passwords: Record<MachvonRole, string>) => Promise<void>;

export interface TestDatabaseOptions {
  /** Prefix of the unique temporary working directory. Defaults to `machvon-pg-`. */
  tempPrefix?: string;
  /** Creates the MACHVON roles once the server accepts connections. Defaults to the real six-role setup. */
  provisionRoles?: RoleProvisioner;
}

const DEFAULT_TEMP_PREFIX = 'machvon-pg-';
const DATABASE_NAME = 'postgres';
const ADMIN_USER = 'postgres';
// Tests start many servers at once. On Windows each one reserves commit memory, and a full machine fails with
// error 1455 (could not create shared memory segment), so every test server stays small. fsync is off: the data
// directory is thrown away.
const SMALL_SERVER_FLAGS = [
  '-c', 'shared_buffers=16MB',
  '-c', 'max_connections=40',
  '-c', 'max_worker_processes=4',
  '-c', 'autovacuum=off',
  '-c', 'fsync=off',
  '-c', 'synchronous_commit=off',
  '-c', 'full_page_writes=off',
];

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

const createRoles: RoleProvisioner = async (adminUrl, passwords) => {
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
};

/**
 * Starts a real PostgreSQL server (UTF8, C locale) on a free port in a unique temporary
 * directory and creates the six MACHVON roles. Options let tests use a private directory prefix and inject
 * role provisioning (for deterministic failure injection). Callers must stop it in a finally block or afterAll.
 */
export async function startTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const { tempPrefix = DEFAULT_TEMP_PREFIX, provisionRoles = createRoles } = options;
  const workDir = await mkdtemp(join(tmpdir(), tempPrefix));
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
      postgresFlags: SMALL_SERVER_FLAGS,
    });
    await server.initialise();
    await server.start();
    started = true;
    const adminUrl = connectionUrl(ADMIN_USER, adminPassword, port);
    await provisionRoles(adminUrl, passwords);
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
