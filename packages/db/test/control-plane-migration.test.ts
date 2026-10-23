import { resolve } from 'node:path';
import { Client } from 'pg';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import type { MachvonRole, TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PLACEMENT = '00000000-0000-4000-8000-0000000000b1';
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const TENANT_PROVISIONING = '00000000-0000-4000-8000-00000000000c';
const TENANT_SUSPENDED = '00000000-0000-4000-8000-00000000000d';
const TENANT_SECURITY = '00000000-0000-4000-8000-00000000000e';
const TENANT_UNKNOWN = '00000000-0000-4000-8000-0000000000ff';
const USER_1 = '00000000-0000-4000-8000-0000000000a1';
const USER_2 = '00000000-0000-4000-8000-0000000000a2';
const USER_3 = '00000000-0000-4000-8000-0000000000a3';
const UNIT_A = '00000000-0000-4000-8000-0000000000c1';
const UNIT_B = '00000000-0000-4000-8000-0000000000c2';
const MEMBERSHIP_1A = '00000000-0000-4000-8000-0000000000d1';
const MEMBERSHIP_1B = '00000000-0000-4000-8000-0000000000d2';
const MEMBERSHIP_2A = '00000000-0000-4000-8000-0000000000d3';
const RUN_A = '00000000-0000-4000-8000-0000000000e1';

const DIRECTORY_COLUMNS = [
  'display_name',
  'email',
  'membership_id',
  'membership_type',
  'organization_id',
  'phone',
  'status',
  'tenant_id',
  'user_account_id',
  'valid_from',
  'valid_until',
];
const MEMBERSHIP_COLUMNS = ['membership_id', 'membership_type', 'status', 'tenant_id', 'tenant_name', 'tenant_status', 'valid_from', 'valid_until'];

describe('migration V008 control-plane access', () => {
  let database: TestDatabase;

  const connect = async (url: string, tenantId?: string): Promise<Client> => {
    const client = new Client({ connectionString: url });
    await client.connect();
    if (tenantId !== undefined) await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
    return client;
  };

  async function as<T>(role: MachvonRole, tenantId: string | undefined, work: (client: Client) => Promise<T>): Promise<T> {
    const client = await connect(database.urlFor(role), tenantId);
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  async function code(client: Client, text: string, params: unknown[] = []): Promise<string | undefined> {
    try {
      await client.query(text, params);
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    const admin = await connect(database.adminUrl);
    try {
      await admin.query(
        `insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status) values ($1, 'POOL', 'vn-north', 'cluster-1', 'kms-1', 'Active')`,
        [PLACEMENT],
      );
      const tenants: Array<[string, string, string, string, string | null]> = [
        [TENANT_A, 'tenant-a', 'Tenant A', 'Active', null],
        [TENANT_B, 'tenant-b', 'Tenant B', 'Suspended', 'NON_PAYMENT'],
        [TENANT_PROVISIONING, 'tenant-c', 'Tenant C', 'Provisioning', null],
        [TENANT_SUSPENDED, 'tenant-d', 'Tenant D', 'Suspended', 'CUSTOMER_REQUEST'],
        [TENANT_SECURITY, 'tenant-e', 'Tenant E', 'Suspended', 'SECURITY_INCIDENT'],
      ];
      for (const [id, code_, name, status, reason] of tenants) {
        await admin.query(
          `insert into machvon.tenant (id, code, name, status, placement_id, region, lifecycle_reason) values ($1, $2, $3, $4, $5, 'vn-north', $6)`,
          [id, code_, name, status, PLACEMENT, reason],
        );
      }
      const users: Array<[string, string, string, string | null]> = [
        [USER_1, 'sub-1', 'nguyen.van@example.vn', '+84912345678'],
        [USER_2, 'sub-2', 'tran.thi@example.vn', null],
        [USER_3, 'sub-3', 'le.minh@example.vn', '+84987654321'],
      ];
      for (const [id, subject, email, phone] of users) {
        await admin.query(
          `insert into machvon.user_account (id, idp_subject, email_normalized, display_name, phone_e164, status) values ($1, $2, $3, $4, $5, 'Active')`,
          [id, subject, email, `Name ${subject}`, phone],
        );
      }
      for (const [tenant, unit, memberships] of [
        [TENANT_A, UNIT_A, [[MEMBERSHIP_1A, USER_1], [MEMBERSHIP_2A, USER_2]]],
        [TENANT_B, UNIT_B, [[MEMBERSHIP_1B, USER_1]]],
      ] as const) {
        await admin.query(`select set_config('app.tenant_id', $1, false)`, [tenant]);
        await admin.query(`insert into machvon.organization_unit (tenant_id, id, code, name, valid_from) values ($1, $2, 'ROOT', 'Root', date '2026-01-01')`, [tenant, unit]);
        for (const [membership, user] of memberships) {
          await admin.query(
            `insert into machvon.membership (tenant_id, id, user_id, organization_id, status) values ($1, $2, $3, $4, 'Active')`,
            [tenant, membership, user, unit],
          );
        }
      }
      await admin.query(`select set_config('app.tenant_id', $1, false)`, [TENANT_A]);
      await admin.query(
        `insert into machvon.tenant_provisioning_run (tenant_id, id, attempt, temporal_workflow_id, status, current_step, steps_json, requested_by)
         values ($1, $2, 1, $3, 'Running', 'keycloak.organisation', '[]', $4)`,
        [TENANT_A, RUN_A, `prov:${TENANT_A}:1`, USER_1],
      );
    } finally {
      await admin.end();
    }
  }, 180_000);

  afterAll(async () => {
    if (database) await database.stop();
  }, 60_000);

  describe('machvon_control on control-plane tables', () => {
    it('reads and writes tenant, placement, user_account and the plan catalogue', async () => {
      await as('machvon_control', undefined, async (client) => {
        expect((await client.query('select count(*)::int as n from machvon.tenant')).rows[0].n).toBe(5);
        expect(await code(client, "update machvon.tenant set name = 'Tenant A (renamed)' where id = $1", [TENANT_A])).toBeUndefined();
        expect(await code(client, "update machvon.tenant set name = 'Tenant A' where id = $1", [TENANT_A])).toBeUndefined();
        expect(await code(client, "update machvon.placement set status = 'Active' where id = $1", [PLACEMENT])).toBeUndefined();
        expect(await code(client, "update machvon.user_account set locale = 'vi-VN' where id = $1", [USER_1])).toBeUndefined();
        expect(await code(client, 'select count(*) from machvon.product_plan_version')).toBeUndefined();
        expect(await code(client, 'select count(*) from machvon.plan_feature')).toBeUndefined();
        expect(await code(client, 'select count(*) from machvon.notification_event_type')).toBeUndefined();
      });
    });

    it('cannot delete a tenant, truncate, or change or remove a signing key (V012 lets it read and register them)', async () => {
      await as('machvon_control', undefined, async (client) => {
        expect(await code(client, 'delete from machvon.tenant where id = $1', [TENANT_UNKNOWN])).toBe('42501');
        expect(await code(client, 'truncate machvon.tenant')).toBe('42501');
        expect(await code(client, 'select count(*) from machvon.license_signing_key')).toBeUndefined();
        expect(await code(client, "update machvon.license_signing_key set status = 'Revoked'")).toBe('42501');
        expect(await code(client, 'delete from machvon.license_signing_key')).toBe('42501');
      });
    });

    it('keeps the application role away from the control plane', async () => {
      await as('machvon_app', TENANT_A, async (client) => {
        expect(await code(client, 'select count(*) from machvon.tenant')).toBe('42501');
        expect(await code(client, 'select count(*) from machvon.user_account')).toBe('42501');
        expect(await code(client, 'select count(*) from machvon.placement')).toBe('42501');
      });
    });
  });

  describe('machvon_control on tenant tables', () => {
    it('has no privilege on business tables, with or without a tenant', async () => {
      await as('machvon_control', TENANT_A, async (client) => {
        expect(await code(client, 'select count(*) from machvon.organization_unit')).toBe('42501');
        expect(await code(client, 'select count(*) from machvon.membership')).toBe('42501');
        expect(await code(client, 'select count(*) from machvon.role_grant')).toBe('42501');
      });
    });

    it('sees provisioning runs only of the tenant it names (row-level security still applies)', async () => {
      await as('machvon_control', undefined, async (client) => {
        expect((await client.query('select count(*)::int as n from machvon.tenant_provisioning_run')).rows[0].n).toBe(0);
      });
      await as('machvon_control', TENANT_B, async (client) => {
        expect((await client.query('select count(*)::int as n from machvon.tenant_provisioning_run')).rows[0].n).toBe(0);
      });
      await as('machvon_control', TENANT_A, async (client) => {
        const rows = (await client.query('select id from machvon.tenant_provisioning_run')).rows;
        expect(rows.map((row) => row.id)).toEqual([RUN_A]);
        expect(await code(client, 'delete from machvon.tenant_provisioning_run')).toBe('42501');
      });
    });

    it('writes audit rows and outbox events but can never change or delete audit rows', async () => {
      await as('machvon_control', TENANT_A, async (client) => {
        expect(
          await code(
            client,
            `insert into machvon.audit_event (tenant_id, id, actor_id, action, resource_type, resource_id, safe_diff, correlation_id, request_id, occurred_at)
             values ($1, gen_random_uuid(), $2, 'tenant.requested', 'tenant', $1, '{}', $2, $2, now())`,
            [TENANT_A, USER_1],
          ),
        ).toBeUndefined();
        expect(await code(client, "update machvon.audit_event set action = 'x'")).toBe('42501');
        expect(await code(client, 'delete from machvon.audit_event')).toBe('42501');
        expect(await code(client, 'truncate machvon.audit_event')).toBe('42501');
      });
    });
  });

  describe('machvon.memberships_of_user', () => {
    it('lists the memberships of the named user across tenants, with exactly the documented columns', async () => {
      await as('machvon_control', undefined, async (client) => {
        const result = await client.query('select * from machvon.memberships_of_user($1) order by tenant_id', [USER_1]);
        expect(result.fields.map((field) => field.name).sort()).toEqual(MEMBERSHIP_COLUMNS);
        expect(result.rows.map((row) => [row.tenant_id, row.membership_id, row.tenant_status, row.tenant_name])).toEqual([
          [TENANT_A, MEMBERSHIP_1A, 'Active', 'Tenant A'],
          [TENANT_B, MEMBERSHIP_1B, 'Suspended', 'Tenant B'],
        ]);
        const other = await client.query('select membership_id from machvon.memberships_of_user($1)', [USER_2]);
        expect(other.rows.map((row) => row.membership_id)).toEqual([MEMBERSHIP_2A]);
      });
    });

    it('returns nothing for a user without memberships and for an unknown user', async () => {
      await as('machvon_control', undefined, async (client) => {
        expect((await client.query('select * from machvon.memberships_of_user($1)', [USER_3])).rowCount).toBe(0);
        expect((await client.query('select * from machvon.memberships_of_user($1)', [TENANT_UNKNOWN])).rowCount).toBe(0);
      });
    });

    it('leaves the tenant setting of the calling transaction exactly as it found it', async () => {
      await as('machvon_control', undefined, async (client) => {
        await client.query('begin');
        await client.query('select * from machvon.memberships_of_user($1)', [USER_1]);
        const unset = (await client.query("select nullif(current_setting('app.tenant_id', true), '') as tenant")).rows[0].tenant;
        expect(unset).toBeNull();
        await client.query("select set_config('app.tenant_id', $1, true)", [TENANT_A]);
        await client.query('select * from machvon.memberships_of_user($1)', [USER_1]);
        expect((await client.query("select current_setting('app.tenant_id', true) as tenant")).rows[0].tenant).toBe(TENANT_A);
        await client.query('rollback');
      });
    });

    it('is not executable by the application role or by the public', async () => {
      await as('machvon_app', TENANT_A, async (client) => {
        expect(await code(client, 'select * from machvon.memberships_of_user($1)', [USER_1])).toBe('42501');
      });
      await as('machvon_reporting', undefined, async (client) => {
        expect(await code(client, 'select * from machvon.memberships_of_user($1)', [USER_1])).toBe('42501');
      });
    });
  });

  describe('machvon.tenant_runtime', () => {
    it('derives the access policy from the lifecycle state', async () => {
      await as('machvon_control', undefined, async (client) => {
        const policyOf = async (tenant: string): Promise<unknown[]> =>
          (await client.query('select status, access_policy from machvon.tenant_runtime($1)', [tenant])).rows.map((row) => [row.status, row.access_policy]);
        expect(await policyOf(TENANT_A)).toEqual([['Active', 'FULL']]);
        expect(await policyOf(TENANT_SUSPENDED)).toEqual([['Suspended', 'READ_ONLY_EXPORT']]);
        expect(await policyOf(TENANT_SECURITY)).toEqual([['Suspended', 'NO_ACCESS']]);
        expect(await policyOf(TENANT_PROVISIONING)).toEqual([['Provisioning', 'NO_ACCESS']]);
        expect(await policyOf(TENANT_UNKNOWN)).toEqual([]);
      });
    });

    it('lets the application role ask about its own tenant only', async () => {
      await as('machvon_app', TENANT_A, async (client) => {
        expect((await client.query('select status from machvon.tenant_runtime($1)', [TENANT_A])).rows).toEqual([{ status: 'Active' }]);
        expect((await client.query('select status from machvon.tenant_runtime($1)', [TENANT_B])).rowCount).toBe(0);
      });
    });
  });

  describe('view tenant_user_directory', () => {
    it('masks email and phone unless the transaction may read personal data', async () => {
      await as('machvon_app', TENANT_A, async (client) => {
        const masked = await client.query('select * from machvon.tenant_user_directory where user_account_id = $1', [USER_1]);
        expect(masked.fields.map((field) => field.name).sort()).toEqual(DIRECTORY_COLUMNS);
        expect(masked.rows).toHaveLength(1);
        expect(masked.rows[0]).toMatchObject({ email: 'n***@example.vn', phone: '*********678', membership_id: MEMBERSHIP_1A });
        await client.query("select set_config('app.can_read_pii', 'true', false)");
        const clear = await client.query('select email, phone from machvon.tenant_user_directory where user_account_id = $1', [USER_1]);
        expect(clear.rows[0]).toEqual({ email: 'nguyen.van@example.vn', phone: '+84912345678' });
      });
    });

    it('shows a member without a phone as null and only the rows of the current tenant', async () => {
      await as('machvon_app', TENANT_A, async (client) => {
        const rows = (await client.query('select user_account_id, phone, tenant_id from machvon.tenant_user_directory order by user_account_id')).rows;
        expect(rows.map((row) => row.user_account_id)).toEqual([USER_1, USER_2]);
        expect(rows.find((row) => row.user_account_id === USER_2).phone).toBeNull();
        expect(new Set(rows.map((row) => row.tenant_id))).toEqual(new Set([TENANT_A]));
      });
      await as('machvon_app', TENANT_B, async (client) => {
        const rows = (await client.query('select membership_id from machvon.tenant_user_directory')).rows;
        expect(rows.map((row) => row.membership_id)).toEqual([MEMBERSHIP_1B]);
      });
      await as('machvon_app', undefined, async (client) => {
        expect((await client.query('select count(*)::int as n from machvon.tenant_user_directory')).rows[0].n).toBe(0);
      });
    });

    it('is a security barrier: a leaky predicate never sees a user that no membership of the tenant connects', async () => {
      const admin = await connect(database.adminUrl);
      try {
        // Cheap and not leakproof: without a security barrier the planner may run it on every user_account row before the membership join.
        await admin.query(
          `create or replace function public.directory_leak_probe(value text) returns boolean language plpgsql cost 0.0000001
           as $fn$ begin raise notice 'LEAK:%', value; return true; end; $fn$`,
        );
      } finally {
        await admin.end();
      }
      await as('machvon_app', TENANT_A, async (client) => {
        const seen: string[] = [];
        client.on('notice', (notice) => seen.push(notice.message ?? ''));
        const rows = (await client.query('select display_name from machvon.tenant_user_directory where public.directory_leak_probe(display_name)')).rows;
        expect(rows.map((row) => row.display_name).sort()).toEqual(['Name sub-1', 'Name sub-2']);
        // USER_3 has no membership in tenant A: its name must never reach a function that runs for the caller.
        expect(seen.join(' | ')).not.toContain('sub-3');
      });
    });

    it('is read-only for the application role', async () => {
      await as('machvon_app', TENANT_A, async (client) => {
        expect(await code(client, "update machvon.tenant_user_directory set display_name = 'x'")).toBeDefined();
        expect(await code(client, 'delete from machvon.tenant_user_directory')).toBeDefined();
      });
    });
  });

  it('is part of the committed migrations as V008 and a second application changes nothing', async () => {
    const client = await connect(database.adminUrl);
    try {
      const { rows } = await client.query("select version from machvon.schema_migration where version like 'V008%'");
      expect(rows.map((row) => row.version)).toEqual(['V008__control_plane_access']);
    } finally {
      await client.end();
    }
  });
});
