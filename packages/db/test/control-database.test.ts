import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { ControlDatabase, PLATFORM_TENANT_ID } from '../src/control-database';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PLACEMENT = '00000000-0000-4000-8000-0000000000b1';
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const RUN_A = '00000000-0000-4000-8000-0000000000e1';
const RUN_B = '00000000-0000-4000-8000-0000000000e2';
const REQUESTER = '00000000-0000-4000-8000-0000000000a1';

describe('ControlDatabase', () => {
  let database: TestDatabase;
  const pools: Pool[] = [];

  function controlPool(max: number): Pool {
    const pool = new Pool({ connectionString: database.urlFor('machvon_control'), max });
    pool.on('error', () => undefined);
    pools.push(pool);
    return pool;
  }

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    const admin = new Client({ connectionString: database.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status) values ($1, 'POOL', 'vn-north', 'cluster-1', 'kms-1', 'Active')`,
        [PLACEMENT],
      );
      for (const [id, code, run] of [[TENANT_A, 'tenant-a', RUN_A], [TENANT_B, 'tenant-b', RUN_B]] as const) {
        await admin.query(
          `insert into machvon.tenant (id, code, name, status, placement_id, region) values ($1, $2, $2, 'Active', $3, 'vn-north')`,
          [id, code, PLACEMENT],
        );
        await admin.query("select set_config('app.tenant_id', $1, false)", [id]);
        await admin.query(
          `insert into machvon.tenant_provisioning_run (tenant_id, id, attempt, temporal_workflow_id, status, current_step, steps_json, requested_by)
           values ($1, $2, 1, $3, 'Running', 'keycloak.organisation', '[]', $4)`,
          [id, run, `prov:${id}:1`, REQUESTER],
        );
      }
    } finally {
      await admin.end();
    }
  }, 180_000);

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
    if (database) await database.stop();
  }, 60_000);

  it('names the platform pseudo-tenant used for control commands before a tenant exists', () => {
    expect(PLATFORM_TENANT_ID).toBe('00000000-0000-4000-8000-0000000000aa');
  });

  describe('withControl', () => {
    it('runs one transaction without a tenant setting and commits it', async () => {
      const control = new ControlDatabase(controlPool(2));
      const seen = await control.withControl(async (tx) => {
        const [setting] = await tx.query<{ tenant: string | null }>("select nullif(current_setting('app.tenant_id', true), '') as tenant");
        await tx.query("update machvon.tenant set name = 'Renamed' where id = $1", [TENANT_A]);
        return setting?.tenant;
      });
      expect(seen).toBeNull();
      const [row] = await control.withControl((tx) => tx.query<{ name: string }>('select name from machvon.tenant where id = $1', [TENANT_A]));
      expect(row?.name).toBe('Renamed');
    });

    it('rolls back when the work fails and hands the connection back', async () => {
      const pool = controlPool(1);
      const control = new ControlDatabase(pool);
      await expect(
        control.withControl(async (tx) => {
          await tx.query("update machvon.tenant set name = 'Never' where id = $1", [TENANT_B]);
          throw new Error('work failed');
        }),
      ).rejects.toThrow('work failed');
      const [row] = await control.withControl((tx) => tx.query<{ name: string }>('select name from machvon.tenant where id = $1', [TENANT_B]));
      expect(row?.name).toBe('tenant-b');
      expect(pool.idleCount).toBe(1);
      expect(pool.waitingCount).toBe(0);
    });
  });

  describe('withTenantOf', () => {
    it('sets the tenant only for the transaction so row-level security shows that tenant', async () => {
      const control = new ControlDatabase(controlPool(2));
      const rows = await control.withTenantOf(TENANT_A, (tx) => tx.query<{ id: string }>('select id from machvon.tenant_provisioning_run'));
      expect(rows.map((row) => row.id)).toEqual([RUN_A]);
      const other = await control.withTenantOf(TENANT_B, (tx) => tx.query<{ id: string }>('select id from machvon.tenant_provisioning_run'));
      expect(other.map((row) => row.id)).toEqual([RUN_B]);
      const none = await control.withControl((tx) => tx.query<{ id: string }>('select id from machvon.tenant_provisioning_run'));
      expect(none).toEqual([]);
    });

    it('never leaves the tenant on a pooled connection, after a commit or a rollback', async () => {
      const control = new ControlDatabase(controlPool(1));
      await control.withTenantOf(TENANT_A, () => Promise.resolve());
      await expect(control.withTenantOf(TENANT_B, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
      const [setting] = await control.withControl((tx) => tx.query<{ tenant: string | null }>("select nullif(current_setting('app.tenant_id', true), '') as tenant"));
      expect(setting?.tenant).toBeNull();
    });

    it.each(['', 'not-a-uuid', "'; drop table machvon.tenant; --", 'x'.repeat(40)])('rejects the tenant id %j before a connection is taken', async (tenantId) => {
      const connect = jest.fn();
      const control = new ControlDatabase({ connect } as unknown as Pool);
      await expect(control.withTenantOf(tenantId, () => Promise.resolve())).rejects.toMatchObject({ code: 'TENANT_CONTEXT_INVALID', status: 400 });
      expect(connect).not.toHaveBeenCalled();
    });

    it('survives a backend killed during the work: rejects, raises no uncaught error and recovers', async () => {
      const pool = controlPool(1);
      const control = new ControlDatabase(pool);
      const uncaught: unknown[] = [];
      const record = (error: unknown): void => void uncaught.push(error);
      process.on('uncaughtException', record);
      try {
        await expect(
          control.withTenantOf(TENANT_A, async (tx) => {
            const [self] = await tx.query<{ pid: number }>('select pg_backend_pid() as pid');
            const admin = new Client({ connectionString: database.adminUrl });
            await admin.connect();
            try {
              await admin.query('select pg_terminate_backend($1)', [self?.pid]);
            } finally {
              await admin.end();
            }
            await new Promise((resolveWait) => setTimeout(resolveWait, 300));
            return tx.query('select 1');
          }),
        ).rejects.toThrow();
        await new Promise((resolveWait) => setTimeout(resolveWait, 300));
        expect(uncaught).toEqual([]);
        expect(await control.withControl((tx) => tx.query<{ n: number }>('select 1 as n'))).toEqual([{ n: 1 }]);
      } finally {
        process.off('uncaughtException', record);
      }
    }, 30_000);
  });

  it('is the only way the control role reaches a tenant table: a business table stays closed', async () => {
    const control = new ControlDatabase(controlPool(1));
    await expect(control.withTenantOf(TENANT_A, (tx) => tx.query('select count(*) from machvon.organization_unit'))).rejects.toMatchObject({ code: '42501' });
  });
});
