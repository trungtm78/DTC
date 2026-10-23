import { FetchAlertWebhook, MockAlertWebhook, createAlertSink, safeContext } from './alert-sinks';

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
    expect(webhook.sent).toEqual([{ code: 'JOB_FAILED', context: { job: 'audit-seal', apiToken: '[redacted]', Authorization: '[redacted]', errorClass: 'Error' }, at: NOW.toISOString(), service: 'machvon-api' }]);
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

  it('redacts only keys that look like credentials', () => {
    expect(safeContext({ eventId: 'e', password: 'p', 'api-key': 'k', privateKey: 'x', reason: 'INVALID_TOKEN' })).toEqual({ eventId: 'e', password: '[redacted]', 'api-key': '[redacted]', privateKey: '[redacted]', reason: 'INVALID_TOKEN' });
  });
});
