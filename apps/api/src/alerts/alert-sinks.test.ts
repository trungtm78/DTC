import { FetchAlertWebhook, MockAlertWebhook, createAlertSink, safeContext } from './alert-sinks';

// The marker the redaction writes in place of a credential value.
const REDACTED = '[redacted]';

const NOW = new Date('2026-10-24T00:00:00Z');
const config = { alertWebhookUrl: undefined, telemetry: { exporter: 'none' as const, otlpEndpoint: undefined, serviceName: 'machvon-api' } };

describe('createAlertSink', () => {
  it('writes every alert as one JSON line with the code, the context, the time and the service', () => {
    const lines: string[] = [];
    createAlertSink(config, { now: () => NOW, write: (line) => lines.push(line) }).raise('OUTBOX_LAG', { oldestPendingSeconds: 400 });
    expect(JSON.parse(lines[0] as string)).toEqual({ level: 'alert', code: 'OUTBOX_LAG', context: { oldestPendingSeconds: 400 }, at: '2026-10-24T00:00:00.000Z', service: 'machvon-api' });
  });

  it('also delivers to the webhook adapter, with credentials in the context redacted', async () => {
    const webhook = new MockAlertWebhook();
    createAlertSink(config, { now: () => NOW, write: () => undefined, webhook }).raise('JOB_FAILED', { job: 'audit-seal', apiToken: 'abc', Authorization: 'Bearer x', errorClass: 'Error' });
    await Promise.resolve();
    expect(webhook.sent).toEqual([{ code: 'JOB_FAILED', context: { job: 'audit-seal', apiToken: REDACTED, Authorization: REDACTED, errorClass: 'Error' }, at: NOW.toISOString(), service: 'machvon-api' }]);
  });

  it('never fails the raiser when the delivery fails, and logs that it failed', async () => {
    const lines: string[] = [];
    const broken = { send: () => Promise.reject(new Error('down')) };
    expect(() => createAlertSink(config, { write: (line) => lines.push(line), webhook: broken }).raise('OUTBOX_EVENT_DEAD', {})).not.toThrow();
    await new Promise((done) => setImmediate(done));
    expect(lines.map((line) => JSON.parse(line).level)).toEqual(['alert', 'error']);
    expect(lines[1]).toContain('OUTBOX_EVENT_DEAD');
  });

  it('builds the fetch webhook from the configuration and posts the payload', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetcher = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    createAlertSink({ ...config, alertWebhookUrl: 'https://pager.example.test/hook' }, { now: () => NOW, write: () => undefined, fetch: fetcher }).raise('AUDIT_CHAIN_BROKEN', { tenantId: 't' });
    await Promise.resolve();
    expect(calls[0]?.url).toBe('https://pager.example.test/hook');
    expect(JSON.parse(calls[0]?.body as string)).toMatchObject({ code: 'AUDIT_CHAIN_BROKEN', context: { tenantId: 't' } });
  });

  it('fails a webhook delivery that the collector refused', async () => {
    const refused = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(new FetchAlertWebhook('https://x.test', refused).send({ code: 'X', context: {}, at: '', service: '' })).rejects.toThrow('503');
  });

  it('redacts credentials inside nested objects and arrays, in the log line and in the webhook payload alike', async () => {
    const lines: string[] = [];
    const webhook = new MockAlertWebhook();
    const context = { details: { authorization: 'Bearer secret', safe: 1, deeper: [{ apiKey: 'k', name: 'n' }, 'plain'] }, list: [{ token: 't' }] };
    createAlertSink(config, { now: () => NOW, write: (line) => lines.push(line), webhook }).raise('JOB_FAILED', context);
    await Promise.resolve();
    const expected = { details: { authorization: REDACTED, safe: 1, deeper: [{ apiKey: REDACTED, name: 'n' }, 'plain'] }, list: [{ token: REDACTED }] };
    expect(JSON.parse(lines[0] as string).context).toEqual(expected);
    expect(webhook.sent[0]?.context).toEqual(expected);
    expect(JSON.stringify([lines, webhook.sent])).not.toContain('Bearer secret');
    // The caller's own object is not touched.
    expect(context.details.authorization).toBe('Bearer secret');
  });

  it('keeps an object that refers to itself deliverable instead of failing the raiser', () => {
    const loop: Record<string, unknown> = { name: 'loop', password: 'p' };
    loop.self = loop;
    expect(safeContext({ loop })).toEqual({ loop: { name: 'loop', password: REDACTED, self: '[circular]' } });
  });

  it('redacts the top-level keys of a context that has a custom prototype, and leaves a nested class instance alone', () => {
    const context = Object.assign(Object.create({ inherited: 'x' }) as Record<string, unknown>, { password: 'secret', reason: 'R', nested: { token: 't' } });
    expect(safeContext(context)).toEqual({ password: REDACTED, reason: 'R', nested: { token: REDACTED } });
    class Holder {
      constructor(readonly token: string) {}
    }
    const holder = new Holder('kept');
    expect(safeContext({ holder }).holder).toBe(holder);
  });

  it('redacts only keys that look like credentials', () => {
    expect(safeContext({ eventId: 'e', password: 'p', 'api-key': 'k', privateKey: 'x', reason: 'INVALID_TOKEN' })).toEqual({ eventId: 'e', password: REDACTED, 'api-key': REDACTED, privateKey: REDACTED, reason: 'INVALID_TOKEN' });
  });
});
