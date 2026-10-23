import type { OutboxDelivery } from '@machvon/db';
import { RegisteredEventConsumer, createOutboxPublisher } from './outbox-publisher';
import type { OutboxConsumer } from './outbox-publisher';

const delivery = (type: string, schemaVersion = 1): OutboxDelivery => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  tenantId: '00000000-0000-4000-8000-00000000000a',
  tenantContext: 'signed',
  type,
  schemaVersion,
  aggregateType: 'widget',
  aggregateId: '00000000-0000-4000-8000-0000000000e2',
  aggregateVersion: 1,
  payload: {},
  eventKey: 'widget:1',
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  attempts: 0,
});

class Recording implements OutboxConsumer {
  readonly seen: string[] = [];
  constructor(
    readonly name: string,
    private readonly outcome: 'ok' | Error = 'ok',
  ) {}
  async handle(event: OutboxDelivery): Promise<unknown> {
    this.seen.push(event.type);
    if (this.outcome !== 'ok') throw this.outcome;
    return 'processed';
  }
}

describe('createOutboxPublisher', () => {
  it('hands the delivery to every consumer: each one decides for itself whether the event is its own', async () => {
    const first = new Recording('first');
    const second = new Recording('second');
    await createOutboxPublisher([first, second])(delivery('widget.created.v1'));
    expect(first.seen).toEqual(['widget.created.v1']);
    expect(second.seen).toEqual(['widget.created.v1']);
  });

  it('fails the delivery when a consumer fails, but still gives it to the others (their inbox rows make a retry safe)', async () => {
    const broken = new Recording('broken', new TypeError('boom'));
    const healthy = new Recording('healthy');
    await expect(createOutboxPublisher([broken, healthy])(delivery('widget.created.v1'))).rejects.toThrow(TypeError);
    expect(healthy.seen).toEqual(['widget.created.v1']);
  });

  it('succeeds with no consumer at all', async () => {
    await expect(createOutboxPublisher([])(delivery('widget.created.v1'))).resolves.toBeUndefined();
  });
});

describe('RegisteredEventConsumer', () => {
  const catalog = {
    get: async (eventType: string, schemaVersion: number) => {
      if (eventType === 'widget.registered.v1' && schemaVersion === 1) return { eventType, schemaVersion, payloadSchema: {}, allowedPurposes: ['OPERATIONAL'], status: 'Active' as const };
      if (eventType === 'widget.retired.v1') return { eventType, schemaVersion, payloadSchema: {}, allowedPurposes: ['OPERATIONAL'], status: 'Deprecated' as const };
      return undefined;
    },
  };

  it('passes an event of an Active registered type on', async () => {
    const inner = new Recording('inner');
    const consumer = new RegisteredEventConsumer('notification', catalog, inner);
    expect(consumer.name).toBe('notification');
    await consumer.handle(delivery('widget.registered.v1'));
    expect(inner.seen).toEqual(['widget.registered.v1']);
  });

  it('leaves alone an event that is not a notification source: unregistered type, other version or deprecated type', async () => {
    const inner = new Recording('inner');
    const consumer = new RegisteredEventConsumer('notification', catalog, inner);
    expect(await consumer.handle(delivery('sas.tenant.requested.v1'))).toBe('ignored');
    expect(await consumer.handle(delivery('widget.registered.v1', 2))).toBe('ignored');
    expect(await consumer.handle(delivery('widget.retired.v1'))).toBe('ignored');
    expect(inner.seen).toEqual([]);
  });

  it('fails the delivery when the catalogue cannot be read, so the relay retries instead of dropping the event', async () => {
    const unreadable = { get: () => Promise.reject(new Error('catalogue down')) };
    const consumer = new RegisteredEventConsumer('notification', unreadable, new Recording('inner'));
    await expect(consumer.handle(delivery('widget.registered.v1'))).rejects.toThrow('catalogue down');
  });
});
