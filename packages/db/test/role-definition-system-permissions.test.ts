import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { loadCommittedMigrations } from '../src/generate-migrations';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { SYSTEM_ROLES, seedSystemRoles } from '../src/system-roles';
import { TenantDatabase } from '../src/tenant-database';
import type { MachvonRole, TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TENANT = '00000000-0000-4000-8000-00000000000a';
const ACTOR = '00000000-0000-4000-8000-0000000000f1';

async function session(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("select set_config('app.tenant_id', $1, false)", [TENANT]);
  return client;
}

async function failureCode(client: Client, text: string): Promise<string | undefined> {
  try {
    await client.query(text);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

let counter = 0;
const insertRole = (permissions: string, isSystem = false): string => {
  counter += 1;
  const id = `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
  return `insert into machvon.role_definition (tenant_id, id, code, name, permissions, rank, is_system, status, created_by)
    values ('${TENANT}', '${id}', 'ROLE_${counter}', 'n', ${permissions}, 50, ${isSystem}, 'Active', '${ACTOR}')`;
};

describe('migration V007: no role definition may hold a system permission', () => {
  let database: TestDatabase;
  const urlFor = (role: MachvonRole): string => database.urlFor(role);

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
  }, 180_000);

  afterAll(async () => {
    if (database) await database.stop();
  }, 60_000);

  it('is one of the committed migrations', async () => {
    const names = (await loadCommittedMigrations(REPO_ROOT)).map((migration) => migration.name);
    expect(names).toContain('V007__role_definition_system_permissions');
  });

  it.each([
    ['a system.* pattern', "'{system.*}'"],
    ['an exact system permission of the old list', "'{system.tenant.manage}'"],
    ['a system permission the old list missed', "'{system.tenant.read}'"],
    ['a system permission among ordinary ones', "'{iam.unit.manage,system.support.request}'"],
    ['an unknown system.x.y name', "'{system.x.y}'"],
  ])('refuses %s for the application role and for the owner role (SQLSTATE 23514)', async (_label, permissions) => {
    for (const role of ['machvon_app', 'machvon_owner'] as const) {
      const client = await session(urlFor(role));
      try {
        expect(await failureCode(client, insertRole(permissions))).toBe('23514');
      } finally {
        await client.end();
      }
    }
  });

  it('refuses to update an existing role into holding a system permission', async () => {
    const owner = await session(urlFor('machvon_owner'));
    try {
      await owner.query(insertRole("'{iam.unit.manage}'"));
      expect(await failureCode(owner, `update machvon.role_definition set permissions = '{system.*}' where code = 'ROLE_${counter}'`)).toBe('23514');
    } finally {
      await owner.end();
    }
  });

  it('still accepts ordinary permissions, patterns that are not system ones, and names that merely contain "system"', async () => {
    const app = await session(urlFor('machvon_app'));
    try {
      expect(await failureCode(app, insertRole("'{iam.unit.manage,iam.*,subsystem.read,ecosystem.*,systems.read,systemx}'"))).toBeUndefined();
    } finally {
      await app.end();
    }
  });

  it('keeps the seeded system roles insertable', async () => {
    const pool = new Pool({ connectionString: urlFor('machvon_app'), max: 2 });
    try {
      const tenants = new TenantDatabase(pool);
      const otherTenant = '00000000-0000-4000-8000-0000000000bb';
      const result = await tenants.withTenant({ tenantId: otherTenant, membershipId: ACTOR, scopeVersion: 1 }, (tx) => seedSystemRoles(tx, ACTOR));
      expect(result.inserted).toBe(SYSTEM_ROLES.length);
    } finally {
      await pool.end();
    }
  });
});
