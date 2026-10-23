import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { loadCommittedMigrations } from './generate-migrations.ts';
import { migrate } from './migrate.ts';
import { MACHVON_ROLES } from './roles.ts';
import { startTestServer } from './test-database.ts';
import type { MachvonRole, TestDatabase } from './test-database.ts';

/** Environment variable that carries the shared server's record from the jest global setup to the test workers. */
export const SHARED_DATABASE_ENV = 'MACHVON_SHARED_DB';
/** Setting the variable to this value turns the shared server off: every suite then starts a server of its own. */
const SHARED_DATABASE_OFF = 'off';
const DEFAULT_TEMP_PREFIX = 'machvon-pg-shared-';
const TEMPLATE_NAME = 'machvon_template';
const ADMIN_DATABASE = 'postgres';
// The server is shared by every worker of a run, each with several connection pools.
const SHARED_MAX_CONNECTIONS = 300;
const CLONE_PREFIX = 'machvon_t_';
const OBJECT_IN_USE = '55006';
const CLONE_ATTEMPTS = 10;

/** What the workers need to reach the server: plain JSON so it can travel in an environment variable. */
export interface SharedDatabaseRecord {
  port: number;
  adminPassword: string;
  passwords: Record<MachvonRole, string>;
  templateName: string;
  /** The repository root whose migrations were applied to the template. */
  root: string;
}

function isRecord(value: unknown): value is SharedDatabaseRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SharedDatabaseRecord>;
  const passwords = candidate.passwords as Record<string, unknown> | undefined;
  return (
    Number.isInteger(candidate.port) &&
    typeof candidate.adminPassword === 'string' &&
    typeof candidate.templateName === 'string' &&
    typeof candidate.root === 'string' &&
    typeof passwords === 'object' &&
    passwords !== null &&
    MACHVON_ROLES.every((role) => typeof passwords[role] === 'string')
  );
}

/** The shared server as the tests see it: connection URLs for the superuser and for each role on any database. */
export class SharedDatabaseInfo {
  readonly record: SharedDatabaseRecord;

  constructor(record: SharedDatabaseRecord) {
    this.record = record;
  }

  get port(): number {
    return this.record.port;
  }

  get passwords(): Record<MachvonRole, string> {
    return this.record.passwords;
  }

  get templateName(): string {
    return this.record.templateName;
  }

  get root(): string {
    return this.record.root;
  }

  adminUrlOf(database: string): string {
    return `postgres://postgres:${this.record.adminPassword}@localhost:${this.record.port}/${database}`;
  }

  urlOf(role: MachvonRole, database: string): string {
    return `postgres://${role}:${this.record.passwords[role]}@localhost:${this.record.port}/${database}`;
  }
}

export interface SharedDatabase {
  info: SharedDatabaseInfo;
  /** Stops the server and removes its directory. */
  stop(): Promise<void>;
}

export interface SharedDatabaseOptions {
  /** Prefix of the temporary directory; the orphan cleanup finds a leftover server by it. */
  tempPrefix?: string;
  maxConnections?: number;
}

async function withAdmin<T>(url: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Starts ONE server, creates the MACHVON roles and applies every committed migration of `root` (test profile) to a
 * template database. The template accepts no connections, so a clone can always be taken from it.
 */
export async function startSharedDatabase(root: string, options: SharedDatabaseOptions = {}): Promise<SharedDatabase> {
  const server = await startTestServer({
    tempPrefix: options.tempPrefix ?? DEFAULT_TEMP_PREFIX,
    maxConnections: options.maxConnections ?? SHARED_MAX_CONNECTIONS,
  });
  try {
    await withAdmin(server.adminUrlFor(ADMIN_DATABASE), (client) => client.query(`CREATE DATABASE "${TEMPLATE_NAME}"`));
    await migrate(server.adminUrlFor(TEMPLATE_NAME), await loadCommittedMigrations(root), { profile: 'test' });
    await withAdmin(server.adminUrlFor(ADMIN_DATABASE), (client) =>
      client.query(`ALTER DATABASE "${TEMPLATE_NAME}" WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`),
    );
  } catch (error) {
    await server.stop();
    throw error;
  }
  const info = new SharedDatabaseInfo({
    port: server.port,
    adminPassword: server.adminPassword,
    passwords: server.passwords,
    templateName: TEMPLATE_NAME,
    root,
  });
  return { info, stop: server.stop };
}

/**
 * The shared server of this test run, or undefined when there is none (the variable is unset or `off`): then a suite
 * starts a server of its own. A variable that holds something else is an error, never silently ignored.
 */
export function sharedDatabaseInfo(env: Record<string, string | undefined> = process.env): SharedDatabaseInfo | undefined {
  const raw = env[SHARED_DATABASE_ENV];
  if (raw === undefined || raw === '' || raw === SHARED_DATABASE_OFF) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${SHARED_DATABASE_ENV} is not valid JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`${SHARED_DATABASE_ENV} does not hold a shared database record`);
  return new SharedDatabaseInfo(parsed);
}

function requireInfo(info: SharedDatabaseInfo | undefined): SharedDatabaseInfo {
  const resolved = info ?? sharedDatabaseInfo();
  if (resolved === undefined) {
    throw new Error(`no shared test database: run the suites through the jest global setup (${SHARED_DATABASE_ENV} is not set)`);
  }
  return resolved;
}

let counter = 0;

function newDatabaseName(): string {
  counter += 1;
  return `${CLONE_PREFIX}${process.pid}_${counter}_${randomBytes(3).toString('hex')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createDatabase(info: SharedDatabaseInfo, statement: (name: string) => string): Promise<TestDatabase> {
  const name = newDatabaseName();
  // Taking a copy briefly needs the template alone; a concurrent copy can report it as busy, which passes.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await withAdmin(info.adminUrlOf(ADMIN_DATABASE), (client) => client.query(statement(name)));
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== OBJECT_IN_USE || attempt >= CLONE_ATTEMPTS) throw error;
      await sleep(50 * attempt);
    }
  }
  let dropped = false;
  return {
    adminUrl: info.adminUrlOf(name),
    urlFor: (role) => info.urlOf(role, name),
    async stop() {
      if (dropped) return;
      dropped = true;
      // WITH (FORCE) disconnects a pool that a suite forgot to close, so the drop cannot hang.
      await withAdmin(info.adminUrlOf(ADMIN_DATABASE), (client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}

/** A private copy of the migrated template: the schema, the grants and the roles' passwords of the shared server. */
export function createTestDatabase(info?: SharedDatabaseInfo): Promise<TestDatabase> {
  const resolved = requireInfo(info);
  return createDatabase(resolved, (name) => `CREATE DATABASE "${name}" TEMPLATE "${resolved.templateName}" STRATEGY FILE_COPY`);
}

/** A private empty database on the shared server: the roles exist, there is no schema. */
export function createEmptyTestDatabase(info?: SharedDatabaseInfo): Promise<TestDatabase> {
  return createDatabase(requireInfo(info), (name) => `CREATE DATABASE "${name}"`);
}

/** Runs the work against a private copy of the template and drops the copy afterwards. */
export async function withTestDatabase<T>(work: (database: TestDatabase) => Promise<T>): Promise<T> {
  const database = await createTestDatabase();
  try {
    return await work(database);
  } finally {
    await database.stop();
  }
}
