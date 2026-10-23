import { randomUUID } from 'node:crypto';
import { DomainError } from '@machvon/kernel';
import { enqueueOutbox } from '../src/outbox';
import { NotificationStore } from '../src/notification-store';
import type { NewNotification } from '../src/notification-store';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, memberId } from './support/authz-fixtures';

const harness = new AuthzHarness();
const store = new NotificationStore();
const RECIPIENT = 1;
const OTHER = 2;
const WORKFLOW = '00000000-0000-4000-8000-0000000000b1';
const WORKFLOW_V2 = '00000000-0000-4000-8000-0000000000b2';
const RESOURCE_ID = '00000000-0000-4000-8000-0000000000c1';

function newNotification(overrides: Partial<NewNotification> = {}): NewNotification {
  return {
    eventId: randomUUID(),
    workflowVersionId: WORKFLOW,
    recipientId: memberId(RECIPIENT),
    purpose: 'OPERATIONAL',
    dedupeKey: `n1:${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`,
    expiresAt: new Date(Date.now() + 3_600_000),
    sourceEventType: 'project.stage.changed',
    eventVersion: 1,
    priority: 'NORMAL',
    ackRequired: false,
    ...overrides,
  };
}

async function eventWithRef(): Promise<string> {
  const { id } = await harness.tenants.withTenant(contextFor(TENANT_A, memberId(RECIPIENT)), (tx) =>
    enqueueOutbox(tx, {
      aggregateType: 'project',
      aggregateId: RESOURCE_ID,
      aggregateVersion: 1,
      type: 'project.stage.changed',
      schemaVersion: 1,
      payload: { notification: { resource: { type: 'project', id: RESOURCE_ID }, deepLink: `/prj/prj-01/${RESOURCE_ID}` } },
      eventKey: `evt-${randomUUID()}`,
      correlationId: randomUUID(),
    }),
  );
  return id;
}

describe('NotificationStore', () => {
  const ctx = (member: number) => contextFor(TENANT_A, memberId(member));

  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [{ n: 1, path: '/1/' }]);
    await harness.seedUnits(TENANT_B, [{ n: 1, path: '/1/' }]);
    await harness.seedMembership(TENANT_A, RECIPIENT, 1);
    await harness.seedMembership(TENANT_A, OTHER, 1);
    await harness.seedMembership(TENANT_B, RECIPIENT, 1);
    for (const [tenant, id, status, revision, eventType] of [
      [TENANT_A, WORKFLOW, 'Published', 1, 'project.stage.changed'],
      [TENANT_A, WORKFLOW_V2, 'Draft', 2, 'project.stage.changed'],
      [TENANT_B, WORKFLOW, 'Published', 1, 'other.tenant.event'],
    ] as const) {
      await harness.owner(tenant, [
        [
          `insert into machvon.workflow_version (tenant_id, id, business_type, revision, definition_json, status, kind, event_type, created_by, definition_hash)
           values ($1, $2, 'NOTIFICATION', $3, '{"priority":"HIGH"}'::jsonb, $4, 'NOTIFICATION', $6, $5, repeat('a', 64))`,
          [tenant, id, revision, status, '00000000-0000-4000-8000-0000000000f0', eventType],
        ],
      ]);
    }
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  describe('insert', () => {
    it('writes a Delivered in-app notification once per dedupe key', async () => {
      const input = newNotification();
      const first = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.insert(tx, input));
      const second = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.insert(tx, { ...input, eventId: randomUUID(), workflowVersionId: WORKFLOW_V2 }));
      expect(first.created).toBe(true);
      expect(second).toEqual({ id: first.id, created: false });
      const [row] = await harness.owner<{ status: string; channel_plan: string[]; priority: string; n: string }>(TENANT_A, [
        ['select status, channel_plan, priority, (select count(*) from machvon.notification_instance where dedupe_key = $1)::text as n from machvon.notification_instance where id = $2', [input.dedupeKey, first.id]],
      ]);
      expect(row).toEqual({ status: 'Delivered', channel_plan: ['IN_APP'], priority: 'NORMAL', n: '1' });
    });

    it('refuses a dedupe key that is not in the n1 format', async () => {
      await expect(harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.insert(tx, newNotification({ dedupeKey: 'not-a-key' })))).rejects.toMatchObject({ code: '23514' });
    });

    it('keeps tenants apart: the same key can exist once per tenant', async () => {
      const input = newNotification();
      await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.insert(tx, input));
      const inB = await harness.tenants.withTenant(contextFor(TENANT_B, memberId(RECIPIENT)), (tx) => store.insert(tx, input));
      expect(inB.created).toBe(true);
    });
  });

  describe('workflowFor and eventTime', () => {
    it('finds only the Published workflow of the event type', async () => {
      const found = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.workflowFor(tx, 'project.stage.changed'));
      expect(found?.id).toBe(WORKFLOW);
      expect(found?.definition).toEqual({ priority: 'HIGH' });
      expect(await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.workflowFor(tx, 'unknown.event'))).toBeUndefined();
      expect(await harness.tenants.withTenant(contextFor(TENANT_B, memberId(RECIPIENT)), (tx) => store.workflowFor(tx, 'project.stage.changed'))).toBeUndefined();
    });

    it('reads the time of an outbox event', async () => {
      const eventId = await eventWithRef();
      const time = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.eventTime(tx, eventId));
      expect(Math.abs((time?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
      expect(await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.eventTime(tx, randomUUID()))).toBeUndefined();
    });
  });

  describe('the inbox', () => {
    it('lists the caller own notifications newest first with the event reference, in keyset pages', async () => {
      const mine = [];
      for (let n = 0; n < 5; n += 1) {
        const eventId = await eventWithRef();
        mine.push(await harness.tenants.withTenant(ctx(OTHER), (tx) => store.insert(tx, newNotification({ eventId, recipientId: memberId(OTHER) }))));
      }
      const first = await harness.tenants.withTenant(ctx(OTHER), (tx) => store.listFor(tx, memberId(OTHER), { limit: 3, after: undefined }));
      expect(first).toHaveLength(3);
      expect(first[0]?.ref?.resource).toEqual({ type: 'project', id: RESOURCE_ID });
      expect(first[0]?.ref?.deepLink).toBe(`/prj/prj-01/${RESOURCE_ID}`);
      const last = first[2];
      const rest = await harness.tenants.withTenant(ctx(OTHER), (tx) =>
        store.listFor(tx, memberId(OTHER), { limit: 3, after: { code: last?.createdKey ?? '', id: last?.id ?? '' } }),
      );
      expect(rest).toHaveLength(2);
      expect([...first, ...rest].map((row) => row.id).sort()).toEqual(mine.map((row) => row.id).sort());
      expect(first.every((row) => row.recipientId === memberId(OTHER))).toBe(true);
    });

    it.each([
      ['a text that is not a timestamp', 'not-a-date'],
      ['an impossible calendar date', '2026-13-45T00:00:00.000000Z'],
      ['a timestamp without microseconds', '2026-10-23T08:00:00Z'],
      ['an empty text', ''],
    ])('refuses a cursor holding %s with 422 VALIDATION_FAILED instead of a database cast error', async (_label, code) => {
      const anchor = { code, id: randomUUID() };
      const ctx = contextFor(TENANT_A, memberId(RECIPIENT));
      await expect(harness.tenants.withTenant(ctx, (tx) => store.listFor(tx, memberId(RECIPIENT), { limit: 5, after: anchor }))).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 422,
        detail: 'cursor',
      });
      await expect(harness.tenants.withTenant(ctx, (tx) => store.listAll(tx, { limit: 5, after: anchor }))).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('accepts the cursor shape this store issues', async () => {
      const anchor = { code: '2026-10-23T08:00:00.123456Z', id: randomUUID() };
      const ctx = contextFor(TENANT_A, memberId(RECIPIENT));
      await expect(harness.tenants.withTenant(ctx, (tx) => store.listFor(tx, memberId(RECIPIENT), { limit: 5, after: anchor }))).resolves.toBeDefined();
    });

    it('does not show another member the notification and answers undefined for it', async () => {
      const created = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.insert(tx, newNotification()));
      expect(await harness.tenants.withTenant(ctx(OTHER), (tx) => store.findFor(tx, memberId(OTHER), created.id))).toBeUndefined();
      expect((await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.findFor(tx, memberId(RECIPIENT), created.id)))?.id).toBe(created.id);
    });
  });

  describe('markRead', () => {
    it('sets read_at once, keeps it on a second read and moves the status to Read', async () => {
      const created = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.insert(tx, newNotification()));
      const first = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.markRead(tx, memberId(RECIPIENT), created.id));
      const second = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.markRead(tx, memberId(RECIPIENT), created.id));
      expect(first.status).toBe('Read');
      expect(first.readAt).not.toBeNull();
      expect(second.readAt?.getTime()).toBe(first.readAt?.getTime());
      expect(second.version).toBe(first.version);
    });

    it('answers 404 for a notification of another member and for a missing one', async () => {
      const created = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.insert(tx, newNotification()));
      await expect(harness.tenants.withTenant(ctx(OTHER), (tx) => store.markRead(tx, memberId(OTHER), created.id))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
      await expect(harness.tenants.withTenant(ctx(OTHER), (tx) => store.markRead(tx, memberId(OTHER), randomUUID()))).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('acknowledge (BR-NOT-05)', () => {
    const create = (overrides: Partial<NewNotification>) => harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.insert(tx, newNotification(overrides)));
    const read = (id: string) => harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.markRead(tx, memberId(RECIPIENT), id));
    const acknowledge = (id: string) => harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.acknowledge(tx, memberId(RECIPIENT), id));

    it('refuses a notification that does not require acknowledgement with 422 ACK_NOT_REQUIRED, even after reading it', async () => {
      const { id } = await create({ ackRequired: false });
      await read(id);
      await expect(acknowledge(id)).rejects.toMatchObject({ code: 'ACK_NOT_REQUIRED', status: 422 });
    });

    it('refuses acknowledging before reading with 409 NOTIFICATION_STATE_INVALID', async () => {
      const { id } = await create({ ackRequired: true });
      await expect(acknowledge(id)).rejects.toMatchObject({ code: 'NOTIFICATION_STATE_INVALID', status: 409 });
    });

    it('acknowledges after reading, keeping read different from acknowledged, and is idempotent', async () => {
      const { id } = await create({ ackRequired: true });
      const readRow = await read(id);
      expect(readRow.acknowledgedAt).toBeNull();
      const first = await acknowledge(id);
      const second = await acknowledge(id);
      expect(first.acknowledgedAt).not.toBeNull();
      expect((first.acknowledgedAt?.getTime() ?? 0) >= (first.readAt?.getTime() ?? 1)).toBe(true);
      expect(second.acknowledgedAt?.getTime()).toBe(first.acknowledgedAt?.getTime());
      expect(second.version).toBe(first.version);
    });

    it('refuses an expired notification with 409 NOTIFICATION_EXPIRED', async () => {
      const { id } = await create({ ackRequired: true });
      await read(id);
      await harness.owner(TENANT_A, [["update machvon.notification_instance set expires_at = now() - interval '1 minute' where id = $1", [id]]]);
      await expect(acknowledge(id)).rejects.toMatchObject({ code: 'NOTIFICATION_EXPIRED', status: 409 });
    });
  });

  describe('operator reads', () => {
    it('lists every notification of the tenant and finds one by id, metadata only', async () => {
      const page = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.listAll(tx, { limit: 200, after: undefined }));
      expect(page.length).toBeGreaterThan(5);
      expect(new Set(page.map((row) => row.recipientId)).size).toBeGreaterThan(1);
      const one = await harness.tenants.withTenant(ctx(RECIPIENT), (tx) => store.findAny(tx, page[0]?.id ?? ''));
      expect(one?.id).toBe(page[0]?.id);
      expect(await harness.tenants.withTenant(contextFor(TENANT_B, memberId(RECIPIENT)), (tx) => store.findAny(tx, page[0]?.id ?? ''))).toBeUndefined();
    });
  });
});
