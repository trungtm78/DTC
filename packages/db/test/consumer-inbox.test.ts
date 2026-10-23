import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { signTenantContext } from '@machvon/kernel';
import type { AlertSink, TenantContext } from '@machvon/kernel';
import { Client, Pool } from 'pg';
import { WORKER_MEMBERSHIP_ID, consumeOnce } from '../src/consumer-inbox';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { TenantDatabase } from '../src/tenant-database';
import type { TenantTx } from '../src/tenant-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';
const EVENT_1 = '00000000-0000-4000-8000-0000000000e1';
const EVENT_2 = '00000000-0000-4000-8000-0000000000e2';
const UNIT = '00000000-0000-4000-8000-0000000000d1';

function context(tenantId: string): TenantContext {
  return { tenantId, membershipId: MEMBERSHIP, scopeVersion: 1 };
}

const SIGNING_KEY = randomBytes(32);

/** What the relay hands a consumer: the event id, its tenant and a signed worker context for that tenant. */
function deliveryOf(id: string, tenantId: string, key: Buffer = SIGNING_KEY): { id: string; tenantId: string; tenantContext: string } {
  return { id, tenantId, tenantContext: signTenantContext({ tenantId, membershipId: WORKER_MEMBERSHIP_ID, scopeVersion: 0 }, key) };
}

class RecordingAlerts implements AlertSink {
  readonly raised: Array<{ code: string; context: Record<string, unknown> }> = [];

  raise(code: string, alertContext: Record<string, unknown>): void {
    this.raised.push({ code, context: alertContext });
  }
}

describe('consumeOnce', () => {
  let database: TestDatabase;
  let pool: Pool;
  let tenants: TenantDatabase;
  let alerts: RecordingAlerts;
  const consume = (delivery: Parameters<typeof consumeOnce>[1], consumer: string, work: (tx: TenantTx) => Promise<void>) =>
    consumeOnce(tenants, delivery, consumer, work, { signingKey: SIGNING_KEY, alerts });

  async function admin<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
    const client = new Client({ connectionString: database.adminUrl });
    await client.connect();
    try {
      return (await client.query<T>(text, params)).rows;
    } finally {
      await client.end();
    }
  }

  const insertUnit = async (tx: TenantTx): Promise<void> => {
    await tx.query(
      "insert into machvon.organization_unit (tenant_id, id, code, name, valid_from) values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), 'U', 'Unit', date '2026-01-01')",
    );
  };

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
    alerts = new RecordingAlerts();
    await admin('delete from machvon.integration_event_inbox');
    await admin('delete from machvon.organization_unit');
  });

  it('runs the work once for a repeated delivery', async () => {
    let runs = 0;
    const work = async (tx: TenantTx): Promise<void> => {
      runs += 1;
      await insertUnit(tx);
    };
    expect(await consume(deliveryOf(EVENT_1, TENANT_A), 'effects', work)).toBe('processed');
    expect(await consume(deliveryOf(EVENT_1, TENANT_A), 'effects', work)).toBe('duplicate');
    expect(runs).toBe(1);
    expect(await admin('select id from machvon.organization_unit')).toHaveLength(1);
    const [row] = await admin<{ provider: string; event_key: string; status: string; signature_key_id: string }>(
      'select provider, event_key, status, signature_key_id from machvon.integration_event_inbox',
    );
    expect(row).toEqual({ provider: 'consumer:effects', event_key: EVENT_1, status: 'PROCESSED', signature_key_id: 'internal' });
  });

  it('lets each consumer, and each event, process once', async () => {
    const seen: string[] = [];
    const record = (label: string) => async (): Promise<void> => {
      seen.push(label);
    };
    await consume(deliveryOf(EVENT_1, TENANT_A), 'search', record('search-1'));
    await consume(deliveryOf(EVENT_1, TENANT_A), 'notify', record('notify-1'));
    await consume(deliveryOf(EVENT_2, TENANT_A), 'search', record('search-2'));
    expect(seen).toEqual(['search-1', 'notify-1', 'search-2']);
  });

  it('leaves no inbox row when the work throws, so the next delivery processes it', async () => {
    await expect(
      consume(deliveryOf(EVENT_1, TENANT_A), 'effects', async (tx) => {
        await insertUnit(tx);
        throw new Error('consumer failed');
      }),
    ).rejects.toThrow('consumer failed');
    expect(await admin('select id from machvon.integration_event_inbox')).toHaveLength(0);
    expect(await admin('select id from machvon.organization_unit')).toHaveLength(0);
    expect(await consume(deliveryOf(EVENT_1, TENANT_A), 'effects', insertUnit)).toBe('processed');
  });

  it('runs the work under the delivery tenant as the worker identity', async () => {
    await tenants.withTenant(context(TENANT_B), (tx) =>
      tx.query(
        "insert into machvon.organization_unit (tenant_id, id, code, name, valid_from) values ($1, $2, 'B', 'Other tenant', date '2026-01-01')",
        [TENANT_B, UNIT],
      ),
    );
    let visible = -1;
    await consume(deliveryOf(EVENT_1, TENANT_A), 'effects', async (tx) => {
      visible = (await tx.query('select id from machvon.organization_unit')).length;
    });
    expect(visible).toBe(0);
    expect(WORKER_MEMBERSHIP_ID).toBe('00000000-0000-4000-8000-000000000000');
    const [row] = await admin<{ tenant_id: string }>('select tenant_id from machvon.integration_event_inbox');
    expect(row?.tenant_id).toBe(TENANT_A);
  });

  it('treats the same event id in two tenants as two events', async () => {
    expect(await consume(deliveryOf(EVENT_1, TENANT_A), 'effects', async () => undefined)).toBe('processed');
    expect(await consume(deliveryOf(EVENT_1, TENANT_B), 'effects', async () => undefined)).toBe('processed');
  });

  it('rejects an empty consumer name and an invalid tenant before touching the database', async () => {
    await expect(consume(deliveryOf(EVENT_1, TENANT_A), '  ', async () => undefined)).rejects.toThrow('consumer name');
    await expect(consume({ ...deliveryOf(EVENT_1, TENANT_A), tenantId: "'; drop table x" }, 'effects', async () => undefined)).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_INVALID',
    });
  });

  describe('verifies the signed tenant context of the delivery', () => {
    const untouched = async (): Promise<number> => (await admin('select id from machvon.integration_event_inbox')).length + (await admin('select id from machvon.organization_unit')).length;

    it('refuses a delivery whose tenant id was altered after signing, alerts, and runs nothing (AC-ST-IAM-001-4, AC-ST-KERNEL-022-1)', async () => {
      let runs = 0;
      const forged = { ...deliveryOf(EVENT_1, TENANT_A), tenantId: TENANT_B };
      await expect(consume(forged, 'effects', async () => void (runs += 1))).rejects.toMatchObject({ code: 'TENANT_CONTEXT_INVALID', status: 400 });
      expect(runs).toBe(0);
      expect(await untouched()).toBe(0);
      expect(alerts.raised).toEqual([{ code: 'OUTBOX_CONTEXT_TAMPERED', context: { eventId: EVENT_1, reason: 'TENANT_MISMATCH' } }]);
    });

    it.each([
      ['a token signed with another key', () => deliveryOf(EVENT_1, TENANT_A, randomBytes(32))],
      ['a token that is not a token', () => ({ ...deliveryOf(EVENT_1, TENANT_A), tenantContext: 'not-a-token' })],
      ['a missing token', () => ({ id: EVENT_1, tenantId: TENANT_A, tenantContext: undefined as unknown as string })],
    ])('refuses %s and alerts without echoing the token', async (_label, make) => {
      const delivery = make();
      await expect(consume(delivery, 'effects', async () => undefined)).rejects.toMatchObject({ code: 'TENANT_CONTEXT_INVALID' });
      expect(alerts.raised).toHaveLength(1);
      expect(alerts.raised[0]).toMatchObject({ code: 'OUTBOX_CONTEXT_TAMPERED', context: { eventId: EVENT_1, reason: 'INVALID_TOKEN' } });
      expect(JSON.stringify(alerts.raised)).not.toContain(String(delivery.tenantContext));
    });

    it('refuses an expired token', async () => {
      const token = signTenantContext({ tenantId: TENANT_A, membershipId: WORKER_MEMBERSHIP_ID, scopeVersion: 0 }, SIGNING_KEY, () => 1_000, 300);
      const delivery = { id: EVENT_1, tenantId: TENANT_A, tenantContext: token };
      await expect(
        consumeOnce(tenants, delivery, 'effects', async () => undefined, { signingKey: SIGNING_KEY, alerts, now: () => 2_000 }),
      ).rejects.toMatchObject({ code: 'TENANT_CONTEXT_INVALID' });
      expect(alerts.raised[0]).toMatchObject({ code: 'OUTBOX_CONTEXT_TAMPERED', context: { reason: 'INVALID_TOKEN' } });
    });

    it('runs the work as the verified worker identity and raises no alert for a good delivery', async () => {
      expect(await consume(deliveryOf(EVENT_1, TENANT_A), 'effects', insertUnit)).toBe('processed');
      expect(alerts.raised).toEqual([]);
    });
  });

  it('runs the work once under 10 concurrent deliveries of the same event', async () => {
    let runs = 0;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        consume(deliveryOf(EVENT_2, TENANT_A), 'effects', async () => {
          runs += 1;
        }),
      ),
    );
    expect(runs).toBe(1);
    expect(results.filter((r) => r === 'processed')).toHaveLength(1);
  });
});
