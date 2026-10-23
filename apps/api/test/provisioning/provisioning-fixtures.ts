import { resolve } from 'node:path';
import { ControlDatabase, PLATFORM_TENANT_ID, TenantDatabase, TenantRegistry } from '@machvon/db';
import type { TenantRequestInput } from '@machvon/db';
import { startMigratedTestDatabase } from '@machvon/db/src/migrated-test-database';
import type { TestDatabase } from '@machvon/db/src/test-database';
import { Client, Pool } from 'pg';
import { MockProvisioningPorts } from '../../src/provisioning/mock-ports';
import type { ProvisioningPorts } from '../../src/provisioning/ports';

export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
export const REQUESTER = '00000000-0000-4000-8000-0000000000a1';
export const PLAN_PUBLISHED = '00000000-0000-4000-9600-000000000001';
export const PLAN_DRAFT = '00000000-0000-4000-9600-000000000002';
export const PLACEMENT_NORTH = '00000000-0000-4000-8000-0000000000c1';

/** A port that is down: the code lets the saga record what failed without keeping the message. */
export class PortDown extends Error {
  readonly code = 'PORT_UNAVAILABLE';

  constructor(operation: string) {
    super(`${operation} is down`);
  }
}

/** A stand-in for a process that dies: it is not an error the saga may swallow as a step failure. */
export class Crash extends Error {}

type PortOperation = 'idp.ensureOrganization' | 'dns.ensureRecord' | 'acme.ensureCertificate' | 'storage.ensurePrefix' | 'placement.assign';

/** Mock infrastructure whose operations can be made to fail a number of times, or for ever. */
export class FaultyPorts extends MockProvisioningPorts {
  private readonly failures = new Map<PortOperation, number>();

  constructor() {
    super();
    const wrap = <K extends keyof ProvisioningPorts>(group: K, method: string, name: PortOperation): void => {
      const target = this[group] as unknown as Record<string, (...args: unknown[]) => Promise<void>>;
      const original = target[method];
      if (original === undefined) throw new Error(`no ${group}.${method}`);
      target[method] = async (...args: unknown[]): Promise<void> => {
        const remaining = this.failures.get(name) ?? 0;
        if (remaining > 0) {
          this.failures.set(name, remaining - 1);
          this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
          throw new PortDown(name);
        }
        return original.apply(target, args);
      };
    };
    wrap('idp', 'ensureOrganization', 'idp.ensureOrganization');
    wrap('dns', 'ensureRecord', 'dns.ensureRecord');
    wrap('acme', 'ensureCertificate', 'acme.ensureCertificate');
    wrap('storage', 'ensurePrefix', 'storage.ensurePrefix');
    wrap('placement', 'assign', 'placement.assign');
  }

  failNext(operation: PortOperation, times: number): void {
    this.failures.set(operation, times);
  }

  failAlways(operation: PortOperation): void {
    this.failures.set(operation, Number.MAX_SAFE_INTEGER);
  }

  heal(operation: PortOperation): void {
    this.failures.set(operation, 0);
  }
}

let sequence = 0;

/** The database side of the provisioning tests: migrated PostgreSQL, the control and application pools, a plan and a placement. */
export class ProvisioningHarness {
  database!: TestDatabase;
  controlPool!: Pool;
  appPool!: Pool;
  control!: ControlDatabase;
  tenants!: TenantDatabase;
  registry!: TenantRegistry;

  async start(): Promise<void> {
    this.database = await startMigratedTestDatabase(REPO_ROOT);
    this.controlPool = new Pool({ connectionString: this.database.urlFor('machvon_control'), max: 4 });
    this.controlPool.on('error', () => undefined);
    this.appPool = new Pool({ connectionString: this.database.urlFor('machvon_app'), max: 4 });
    this.appPool.on('error', () => undefined);
    this.control = new ControlDatabase(this.controlPool);
    this.tenants = new TenantDatabase(this.appPool);
    this.registry = new TenantRegistry(this.control);
    await this.admin(async (client) => {
      for (const [id, status, revision] of [[PLAN_PUBLISHED, 'Published', 1], [PLAN_DRAFT, 'Draft', 2]] as const) {
        await client.query(
          `insert into machvon.product_plan_version (id, plan_code, revision, name, status, billing_cycles, base_price_vnd, vat_category, legal_terms_ref)
           values ($1, 'PROVISIONING_TEST', $2, 'Provisioning test', $3, '{MONTHLY}', 0, 'VAT_10', 'terms-1')`,
          [id, revision, status],
        );
      }
      await client.query(
        "insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status) values ($1, 'POOL', 'vn-north', 'north-1', 'kms-1', 'Active')",
        [PLACEMENT_NORTH],
      );
    });
  }

  async stop(): Promise<void> {
    await Promise.all([this.controlPool?.end(), this.appPool?.end()]);
    if (this.database) await this.database.stop();
  }

  async admin<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.database.adminUrl });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    return this.admin(async (client) => Number((await client.query<{ n: string }>(sql, params)).rows[0]?.n));
  }

  input(overrides: Partial<TenantRequestInput> = {}): TenantRequestInput {
    sequence += 1;
    return {
      code: `tenant-${sequence}`,
      name: `Tenant ${sequence}`,
      governingBodyType: 'PROVINCE',
      region: 'vn-north',
      isolationMode: 'POOL',
      planVersionId: PLAN_PUBLISHED,
      rootUnitName: 'Root unit',
      initialOwnerEmail: `owner${sequence}@example.org`,
      platformSubdomain: `tenant-${sequence}`,
      requestedBy: REQUESTER,
      ...overrides,
    };
  }

  /** A tenant in state Requested with attempt 1 Running, the way requestTenantProvisioning leaves it. */
  request(overrides: Partial<TenantRequestInput> = {}): Promise<{ tenantId: string; runId: string; placementId: string; version: number }> {
    return this.control.withTenantOf(PLATFORM_TENANT_ID, (tx) =>
      this.registry.requestTenant(tx, this.input(overrides), PLATFORM_TENANT_ID, () => Promise.resolve()),
    );
  }
}
