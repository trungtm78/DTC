import { resolve } from 'node:path';
import type { TenantContext } from '@machvon/kernel';
import { Client, Pool } from 'pg';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { enqueueOutbox } from '../src/outbox';
import type { OutboxEventInput } from '../src/outbox';
import { TenantDatabase } from '../src/tenant-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';
const AGGREGATE = '00000000-0000-4000-8000-0000000000a1';
const CORRELATION = '00000000-0000-4000-8000-0000000000b1';

function context(tenantId: string): TenantContext {
  return { tenantId, membershipId: MEMBERSHIP, scopeVersion: 1 };
}

function event(eventKey: string, overrides: Partial<OutboxEventInput> = {}): OutboxEventInput {
  return {
    aggregateType: 'contract',
    aggregateId: AGGREGATE,
    aggregateVersion: 3,
    type: 'ContractSubmitted',
    schemaVersion: 1,
    payload: { name: 'Đà Nẵng', amount: 10 },
    eventKey,
    correlationId: CORRELATION,
    ...overrides,
  };
}

describe('enqueueOutbox', () => {
  let database: TestDatabase;
  let pool: Pool;
  let tenants: TenantDatabase;

  async function admin<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
    const client = new Client({ connectionString: database.adminUrl });
    await client.connect();
    try {
      return (await client.query<T>(text, params)).rows;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    pool = new Pool({ connectionString: database.urlFor('machvon_app'), max: 4 });
    tenants = new TenantDatabase(pool);
  }, 180_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.stop();
  }, 60_000);

  beforeEach(async () => {
    await admin('delete from machvon.outbox_event');
  });

  it('writes a PENDING event for the transaction tenant with every column of the input', async () => {
    const result = await tenants.withTenant(context(TENANT_A), (tx) => enqueueOutbox(tx, event('k-1', { causationId: CORRELATION })));
    expect(result.duplicate).toBe(false);
    const rows = await admin<Record<string, unknown>>('select * from machvon.outbox_event');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.id,
      tenant_id: TENANT_A,
      aggregate_type: 'contract',
      aggregate_id: AGGREGATE,
      aggregate_version: '3',
      type: 'ContractSubmitted',
      schema_version: 1,
      payload: { name: 'Đà Nẵng', amount: 10 },
      event_key: 'k-1',
      correlation_id: CORRELATION,
      causation_id: CORRELATION,
      status: 'PENDING',
      attempts: 0,
    });
  });

  it('writes one row and reports a duplicate when the event key repeats', async () => {
    const first = await tenants.withTenant(context(TENANT_A), (tx) => enqueueOutbox(tx, event('k-2')));
    const second = await tenants.withTenant(context(TENANT_A), (tx) => enqueueOutbox(tx, event('k-2')));
    expect(second).toEqual({ id: first.id, duplicate: true });
    expect(await admin('select id from machvon.outbox_event')).toHaveLength(1);
  });

  it('reports a duplicate for the second call inside one transaction', async () => {
    const results = await tenants.withTenant(context(TENANT_A), async (tx) => [await enqueueOutbox(tx, event('k-3')), await enqueueOutbox(tx, event('k-3'))]);
    expect(results.map((r) => r.duplicate)).toEqual([false, true]);
  });

  it('lets two tenants use the same event key', async () => {
    await tenants.withTenant(context(TENANT_A), (tx) => enqueueOutbox(tx, event('shared')));
    const other = await tenants.withTenant(context(TENANT_B), (tx) => enqueueOutbox(tx, event('shared')));
    expect(other.duplicate).toBe(false);
    expect(await admin('select id from machvon.outbox_event')).toHaveLength(2);
  });

  it('leaves no row when the transaction rolls back', async () => {
    await expect(
      tenants.withTenant(context(TENANT_A), async (tx) => {
        await enqueueOutbox(tx, event('k-4'));
        throw new Error('command failed after enqueue');
      }),
    ).rejects.toThrow('command failed');
    expect(await admin('select id from machvon.outbox_event')).toHaveLength(0);
  });

  it('hides the event of tenant A from a tenant B transaction', async () => {
    await tenants.withTenant(context(TENANT_A), (tx) => enqueueOutbox(tx, event('k-5')));
    const seen = await tenants.withTenant(context(TENANT_B), (tx) => tx.query<{ id: string }>('select id from machvon.outbox_event'));
    expect(seen).toEqual([]);
  });
});
