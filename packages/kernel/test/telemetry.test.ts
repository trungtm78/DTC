import { randomUUID } from 'node:crypto';
import { correlationOfTraceId, traceIdOfCorrelation, ConsoleSpanExporter, InMemorySpanExporter, NoopSpanExporter, OtlpHttpSpanExporter, Tracer, formatTraceparent, looksSensitive, parseTraceparent, sanitizeSpanAttributes } from '../src/telemetry.ts';
import type { FinishedSpan, SpanExporter } from '../src/telemetry.ts';

const TRACE = '0af7651916cd43dd8448eb211c80319c';
const SPAN = 'b7ad6b7169203331';

describe('sanitizeSpanAttributes (the privacy rule of spans)', () => {
  it('keeps the six allowlisted attributes and drops every other name (AC-ST-KERNEL-050-2)', () => {
    expect(
      sanitizeSpanAttributes({
        tenant_id: 'a-tenant',
        operation_id: 'grantRole',
        request_id: 'r-1',
        correlation_id: 'c-1',
        'http.status_code': 201,
        'db.operation': 'SELECT',
        'user.email': 'an@example.test',
        project_name: 'Bridge',
        body: '{}',
      }),
    ).toEqual({ tenant_id: 'a-tenant', operation_id: 'grantRole', request_id: 'r-1', correlation_id: 'c-1', 'http.status_code': 201, 'db.operation': 'SELECT' });
  });

  it.each([
    ['an email', 'an.nguyen@example.test'],
    ['a bearer token', 'Bearer abc.def.ghi'],
    ['a JWT', 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'],
    ['a token in a URL', '/files?access_token=abc123'],
    ['a signature in a URL', '/files?x=1&signature=abc'],
    ['a phone number', '+84 912 345 678'],
  ])('drops %s even under an allowed name', (_label, value) => {
    expect(sanitizeSpanAttributes({ operation_id: value, request_id: 'ok' })).toEqual({ request_id: 'ok' });
    expect(looksSensitive(value)).toBe(true);
  });

  it('drops objects, arrays, null and values over 200 characters, and keeps booleans and numbers', () => {
    expect(sanitizeSpanAttributes({ tenant_id: { id: 1 }, operation_id: ['x'], request_id: null, correlation_id: 'x'.repeat(201), 'http.status_code': 404, 'db.operation': true })).toEqual({
      'http.status_code': 404,
      'db.operation': true,
    });
    expect(sanitizeSpanAttributes({ correlation_id: 'x'.repeat(200) })).toEqual({ correlation_id: 'x'.repeat(200) });
  });

  it('keeps identifiers that are UUIDs, however many digits they hold in a row', () => {
    for (const id of ['00000000-0000-4000-8000-00000000000a', '12345678-1234-4123-8123-123456789012', randomUUID()]) {
      expect(sanitizeSpanAttributes({ tenant_id: id, request_id: id, correlation_id: id })).toEqual({ tenant_id: id, request_id: id, correlation_id: id });
    }
  });

  it('is not fooled by an inherited property', () => {
    expect(sanitizeSpanAttributes(Object.create({ tenant_id: 'inherited' }))).toEqual({});
  });
});

describe('traceparent', () => {
  it('round-trips a valid header', () => {
    const header = `00-${TRACE}-${SPAN}-01`;
    expect(parseTraceparent(header)).toEqual({ traceId: TRACE, spanId: SPAN, sampled: true });
    expect(formatTraceparent({ traceId: TRACE, spanId: SPAN, sampled: false })).toBe(`00-${TRACE}-${SPAN}-00`);
    expect(parseTraceparent(` ${header} `)?.traceId).toBe(TRACE);
  });

  it.each([undefined, '', 'garbage', `01-${TRACE}-${SPAN}-01`, `00-${TRACE.toUpperCase()}-${SPAN}-01`, `00-${'0'.repeat(32)}-${SPAN}-01`, `00-${TRACE}-${'0'.repeat(16)}-01`, `00-${TRACE}-${SPAN}`])(
    'treats %p as no parent',
    (header) => {
      expect(parseTraceparent(header)).toBeUndefined();
    },
  );
});

describe('Tracer', () => {
  const ids = (): ((bytes: number) => string) => {
    let n = 0;
    return (bytes) => (++n).toString(16).padStart(bytes * 2, '0');
  };
  const at = (seconds: number) => () => new Date(Date.UTC(2026, 9, 24, 0, 0, seconds));

  it('exports one span with allowlisted attributes, timing and no error message', () => {
    const exporter = new InMemorySpanExporter();
    let clock = 0;
    const tracer = new Tracer({ exporter, randomHex: ids(), now: () => at(clock++)() });
    const span = tracer.startSpan('POST /org-units', { attributes: { tenant_id: 't1', 'user.email': 'a@b.test' } });
    span.setAttribute('http.status_code', 500);
    span.setAttribute('exception.message', 'failed for a@b.test');
    span.end('ERROR');
    span.end('OK');
    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0]).toMatchObject({ name: 'POST /org-units', status: 'ERROR', attributes: { tenant_id: 't1', 'http.status_code': 500 } });
    expect(exporter.spans[0]?.attributes).not.toHaveProperty('exception.message');
    expect(exporter.spans[0]?.endedAt.getTime()).toBeGreaterThan(exporter.spans[0]?.startedAt.getTime() as number);
  });

  it('continues the trace of a parent header: same trace id, new span id, the parent recorded', () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer({ exporter, randomHex: ids() });
    const request = tracer.startSpan('request');
    const consumer = tracer.startSpan('outbox consume', { parent: request.traceparent });
    consumer.end();
    request.end();
    const [first, second] = exporter.spans as [FinishedSpan, FinishedSpan];
    expect(first.traceId).toBe(second.traceId);
    expect(first.parentSpanId).toBe(second.spanId);
    expect(first.spanId).not.toBe(second.spanId);
  });

  it('starts a new trace for a malformed parent and exports nothing for an unsampled one', () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer({ exporter, randomHex: ids() });
    tracer.startSpan('a', { parent: 'garbage' }).end();
    expect(exporter.spans[0]?.parentSpanId).toBeUndefined();
    tracer.startSpan('b', { parent: `00-${TRACE}-${SPAN}-00` }).end();
    expect(exporter.spans).toHaveLength(1);
  });

  it('never lets an exporter that throws or rejects fail the span', async () => {
    const throwing: SpanExporter = { export: () => { throw new Error('collector down'); } };
    const rejecting: SpanExporter = { export: () => Promise.reject(new Error('collector down')) };
    for (const exporter of [throwing, rejecting]) {
      expect(() => new Tracer({ exporter }).startSpan('x').end()).not.toThrow();
    }
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('shuts the exporter down when it has a shutdown', async () => {
    let closed = false;
    await new Tracer({ exporter: { export: () => undefined, shutdown: async () => void (closed = true) } }).shutdown();
    expect(closed).toBe(true);
    await expect(new Tracer({ exporter: new InMemorySpanExporter() }).shutdown()).resolves.toBeUndefined();
  });

  it('waits for the exports in flight before the exporter is shut down, so the last spans are delivered', async () => {
    const events: string[] = [];
    let finish: () => void = () => undefined;
    const exporter = {
      export: () =>
        new Promise<void>((resolve) => {
          finish = () => {
            events.push('delivered');
            resolve();
          };
        }),
      shutdown: async () => void events.push('closed'),
    };
    const tracer = new Tracer({ exporter });
    tracer.startSpan('x').end();
    const closing = tracer.shutdown();
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual([]);
    finish();
    await closing;
    expect(events).toEqual(['delivered', 'closed']);
  });

  it('gives up on an export that never settles after the drain time and still shuts the exporter down', async () => {
    let closed = false;
    const exporter = { export: () => new Promise<void>(() => undefined), shutdown: async () => void (closed = true) };
    const tracer = new Tracer({ exporter, shutdownDrainMs: 20 });
    tracer.startSpan('x').end();
    await tracer.shutdown();
    expect(closed).toBe(true);
  });

  it('does not wait for an export that failed, and a failing one does not fail the shutdown', async () => {
    const tracer = new Tracer({ exporter: { export: () => Promise.reject(new Error('collector down')) } });
    tracer.startSpan('x').end();
    await expect(tracer.shutdown()).resolves.toBeUndefined();
  });

  it('keeps nothing in memory with the no-op exporter', () => {
    const exporter = new NoopSpanExporter();
    const tracer = new Tracer({ exporter });
    for (let i = 0; i < 5; i += 1) tracer.startSpan('x').end();
    expect(Object.keys(exporter)).toEqual([]);
  });
});

describe('exporters', () => {
  const span: FinishedSpan = {
    name: 'x',
    traceId: TRACE,
    spanId: SPAN,
    parentSpanId: '1111111111111111',
    startedAt: new Date('2026-10-24T00:00:00.000Z'),
    endedAt: new Date('2026-10-24T00:00:01.000Z'),
    status: 'OK',
    attributes: { tenant_id: 't1', 'http.status_code': 200, 'db.operation': true },
  };

  it('writes one JSON line per span to the console exporter', () => {
    const lines: string[] = [];
    new ConsoleSpanExporter((line) => lines.push(line)).export([span]);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ name: 'x', traceId: TRACE, startedAt: '2026-10-24T00:00:00.000Z' });
  });

  it('posts OTLP JSON to <endpoint>/v1/traces and fails on a refusal', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const answer = (status: number) => (async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return { ok: status < 300, status };
    }) as unknown as typeof fetch;
    await new OtlpHttpSpanExporter({ endpoint: 'http://collector:4318/', serviceName: 'machvon-api', fetch: answer(200) }).export([span]);
    expect(calls[0]?.url).toBe('http://collector:4318/v1/traces');
    const sent = JSON.parse(calls[0]?.body as string);
    const exported = sent.resourceSpans[0].scopeSpans[0].spans[0];
    expect(exported).toMatchObject({ traceId: TRACE, spanId: SPAN, parentSpanId: '1111111111111111', name: 'x', startTimeUnixNano: '1792800000000000000', status: { code: 1 } });
    expect(exported.attributes).toEqual([
      { key: 'tenant_id', value: { stringValue: 't1' } },
      { key: 'http.status_code', value: { intValue: '200' } },
      { key: 'db.operation', value: { boolValue: true } },
    ]);
    await expect(new OtlpHttpSpanExporter({ endpoint: 'http://c', serviceName: 's', fetch: answer(503) }).export([span])).rejects.toThrow('503');
  });
});

describe('correlation and trace ids', () => {
  const correlation = '0af76519-16cd-43dd-8448-eb211c80319c';

  it('turns a correlation id into the trace id of the same request and back', () => {
    expect(traceIdOfCorrelation(correlation)).toBe(TRACE);
    expect(traceIdOfCorrelation(correlation.toUpperCase())).toBe(TRACE);
    expect(correlationOfTraceId(TRACE)).toBe(correlation);
  });

  it.each(['', 'not-a-uuid', '00000000-0000-0000-0000-000000000000', '0af7651916cd43dd8448eb211c80319c'])('has no trace id for %p', (value) => {
    expect(traceIdOfCorrelation(value)).toBeUndefined();
  });

  it('lets a consumer continue the trace of the request through the correlation id of the outbox row (AC-ST-KERNEL-050-1)', () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer({ exporter });
    const traceId = traceIdOfCorrelation(correlation) as string;
    tracer.startSpan('outbox consume', { parent: { traceId, spanId: 'b7ad6b7169203331', sampled: true } }).end();
    expect(exporter.spans[0]?.traceId).toBe(TRACE);
  });
});
