import { resolve } from 'node:path';
import type { TenantContext } from '@machvon/kernel';
import { Client, Pool } from 'pg';
import { consumeOnce } from '../src/consumer-inbox';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { enqueueOutbox } from '../src/outbox';
import { OutboxRelay } from '../src/outbox-relay';
import type { OutboxDelivery } from '../src/outbox-relay';
import { TenantDatabase } from '../src/tenant-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const TENANTS = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';
const AGGREGATE = '00000000-0000-4000-8000-0000000000a1';
const CORRELATION = '00000000-0000-4000-8000-0000000000b1';
const EVENTS = 100;
const RELAY_KILLED_AT_PUBLISH = 37;
const CONSUMER_KILLED_AT_WORK = 61;

function context(tenantId: string): TenantContext {
  return { tenantId, membershipId: MEMBERSHIP, scopeVersion: 1 };
}

// UAT-NFR-OPERABILITY-05: 100 commands, the relay and a consumer are killed mid-run, both restart, and the
// downstream system sees exactly 100 effects.
describe('delivery recovery', () => {
  let database: TestDatabase;
  let appPool: Pool;
  let relayPool: Pool;

  async function admin<T extends object>(text: string, params: unknown[] = []): Promise<T[]> {
    const client = new Client({ connectionString: database.adminUrl });
    await client.connect();
    try {
      return (await client.query<T>(text, params)).rows;
    } finally {
      await client.end();
    }
  }

  const terminate = (role: string): Promise<unknown[]> =>
    admin('select pg_terminate_backend(pid) from pg_stat_activity where usename = $1 and pid <> pg_backend_pid()', [role]);

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    await admin('create table public.delivery_effect (tenant_id uuid not null, event_id uuid not null)');
    await admin('grant insert, select on public.delivery_effect to machvon_app');
    appPool = new Pool({ connectionString: database.urlFor('machvon_app'), max: 4 });
    appPool.on('error', () => undefined);
    // A backend killed while its client is checked out is reported on the client; the failing query carries the error.
    appPool.on('connect', (client) => client.on('error', () => undefined));
    relayPool = new Pool({ connectionString: database.urlFor('machvon_outbox_relay'), max: 2 });
    relayPool.on('error', () => undefined);
  }, 180_000);

  afterAll(async () => {
    if (relayPool) await relayPool.end();
    if (appPool) await appPool.end();
    if (database) await database.stop();
  }, 60_000);

  it('produces exactly 100 downstream effects although the relay and a consumer are killed mid-run', async () => {
    const tenants = new TenantDatabase(appPool);
    for (let n = 1; n <= EVENTS; n += 1) {
      await tenants.withTenant(context(TENANTS[n % 2] as string), (tx) =>
        enqueueOutbox(tx, {
          aggregateType: 'contract',
          aggregateId: AGGREGATE,
          aggregateVersion: n,
          type: 'ContractSubmitted',
          schemaVersion: 1,
          payload: { n },
          eventKey: `cmd-${n}`,
          correlationId: CORRELATION,
        }),
      );
    }

    let publishCalls = 0;
    let workCalls = 0;
    let relayKilled = false;
    let consumerKilled = false;
    const outcomes = { processed: 0, duplicate: 0 };

    const publish = async (delivery: OutboxDelivery): Promise<void> => {
      publishCalls += 1;
      const outcome = await consumeOnce(tenants, delivery, 'effects', async (tx) => {
        workCalls += 1;
        if (workCalls === CONSUMER_KILLED_AT_WORK && !consumerKilled) {
          consumerKilled = true;
          await terminate('machvon_app');
        }
        await tx.query('insert into public.delivery_effect (tenant_id, event_id) values ($1, $2)', [delivery.tenantId, delivery.id]);
      });
      outcomes[outcome] += 1;
      if (publishCalls === RELAY_KILLED_AT_PUBLISH && !relayKilled) {
        relayKilled = true;
        await terminate('machvon_outbox_relay');
      }
    };
    const relay = new OutboxRelay(relayPool, publish);

    let crashes = 0;
    for (let round = 0; round < 12; round += 1) {
      try {
        await relay.runOnce();
      } catch {
        crashes += 1;
      }
      const [pending] = await admin<{ n: string }>("select count(*) as n from machvon.outbox_event where status = 'PENDING'");
      if (pending?.n === '0') break;
      await admin("update machvon.outbox_event set next_attempt_at = now() where status = 'PENDING'");
    }

    expect(relayKilled && consumerKilled).toBe(true);
    expect(crashes).toBe(1);
    const [published] = await admin<{ n: string }>("select count(*) as n from machvon.outbox_event where status = 'PUBLISHED'");
    const [dead] = await admin<{ n: string }>("select count(*) as n from machvon.outbox_event where status = 'DEAD'");
    expect(published?.n).toBe(String(EVENTS));
    expect(dead?.n).toBe('0');
    const [effects] = await admin<{ total: string; distinct: string }>(
      'select count(*) as total, count(distinct (tenant_id, event_id)) as distinct from public.delivery_effect',
    );
    expect(effects).toEqual({ total: String(EVENTS), distinct: String(EVENTS) });
    // The relay was killed after 36 events had been consumed, so their redelivery was recognised as duplicates.
    expect(outcomes.duplicate).toBeGreaterThanOrEqual(RELAY_KILLED_AT_PUBLISH - 1);
  }, 180_000);
});
