import { randomBytes } from 'node:crypto';

/**
 * The only attributes a span may carry (NFR-OBS, privacy by construction): identifiers of the request, never a
 * business or personal value. Everything else is dropped before a span leaves the process.
 */
export const SPAN_ATTRIBUTE_ALLOWLIST: readonly string[] = ['tenant_id', 'operation_id', 'request_id', 'correlation_id', 'http.status_code', 'db.operation'];

const MAX_ATTRIBUTE_LENGTH = 200;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const BEARER = /\bbearer\s+[A-Za-z0-9._~+/=-]+/i;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/;
const TOKEN_IN_URL = /[?&](?:access_token|token|id_token|code|key|secret|sig|signature)=/i;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /(?:\+?\d[\s().-]?){9,}/;

export type SpanAttributeValue = string | number | boolean;

/** Whether a value looks like personal data or a credential: an email, a phone number, a bearer token, a JWT or a token in a URL. */
export function looksSensitive(value: string): boolean {
  // An identifier is never personal data, and its digits must not read as a phone number.
  if (CANONICAL_UUID.test(value)) return false;
  return EMAIL.test(value) || BEARER.test(value) || JWT.test(value) || TOKEN_IN_URL.test(value) || PHONE.test(value);
}

/**
 * Keeps the allowlisted attributes of a span whose values are plain and harmless. A value that looks like an email,
 * a phone number or a token is dropped even under an allowed name (a careless call site cannot leak through it).
 */
export function sanitizeSpanAttributes(attributes: Readonly<Record<string, unknown>>): Record<string, SpanAttributeValue> {
  const kept: Record<string, SpanAttributeValue> = {};
  for (const name of SPAN_ATTRIBUTE_ALLOWLIST) {
    if (!Object.hasOwn(attributes, name)) continue;
    const value = attributes[name];
    if (typeof value === 'number' || typeof value === 'boolean') kept[name] = value;
    else if (typeof value === 'string' && value.length <= MAX_ATTRIBUTE_LENGTH && !looksSensitive(value)) kept[name] = value;
  }
  return kept;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);

/** Reads a W3C `traceparent` header; anything malformed (or an all-zero id) is undefined, so a caller starts a new trace. */
export function parseTraceparent(header: string | undefined): TraceContext | undefined {
  const match = header === undefined ? null : TRACEPARENT.exec(header.trim());
  if (match === null) return undefined;
  const [, traceId = '', spanId = '', flags = '00'] = match;
  if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return undefined;
  return { traceId, spanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 };
}

const UUID_SHAPE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/;

/**
 * A request keeps one correlation id from the edge to the outbox consumer (it is stored on the outbox row). The trace
 * id is that id without its dashes, so a consumer continues the trace of the request that wrote the event without a
 * column of its own: `traceIdOfCorrelation` and `correlationOfTraceId` are each other's inverse.
 */
export function traceIdOfCorrelation(correlationId: string): string | undefined {
  const lower = correlationId.toLowerCase();
  return UUID_SHAPE.test(lower) && lower !== '00000000-0000-0000-0000-000000000000' ? lower.replaceAll('-', '') : undefined;
}

export function correlationOfTraceId(traceId: string): string {
  return `${traceId.slice(0, 8)}-${traceId.slice(8, 12)}-${traceId.slice(12, 16)}-${traceId.slice(16, 20)}-${traceId.slice(20)}`;
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`;
}

export interface FinishedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  startedAt: Date;
  endedAt: Date;
  /** `OK` or `ERROR`; the message of an error is never recorded (it can carry personal data). */
  status: 'OK' | 'ERROR';
  attributes: Readonly<Record<string, SpanAttributeValue>>;
}

export interface SpanExporter {
  export(spans: readonly FinishedSpan[]): void | Promise<void>;
  shutdown?(): Promise<void>;
}

/** Keeps every span it is given, forever: for tests that look at what was exported, never for a running service. */
export class InMemorySpanExporter implements SpanExporter {
  readonly spans: FinishedSpan[] = [];
  export(spans: readonly FinishedSpan[]): void {
    this.spans.push(...spans);
  }
}

/** Drops every span: the exporter of a service whose telemetry is switched off, so nothing accumulates in memory. */
export class NoopSpanExporter implements SpanExporter {
  export(): void {
    // nothing to export
  }
}

export class ConsoleSpanExporter implements SpanExporter {
  private readonly write: (line: string) => void;

  constructor(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)) {
    this.write = write;
  }

  export(spans: readonly FinishedSpan[]): void {
    for (const span of spans) this.write(JSON.stringify({ ...span, startedAt: span.startedAt.toISOString(), endedAt: span.endedAt.toISOString() }));
  }
}

export interface Span {
  readonly context: TraceContext;
  /** The `traceparent` to put in an outgoing message (an outbox delivery) so the consumer continues this trace. */
  readonly traceparent: string;
  setAttribute(name: string, value: unknown): void;
  end(status?: 'OK' | 'ERROR'): void;
}

const DEFAULT_SHUTDOWN_DRAIN_MS = 5_000;

export interface TracerOptions {
  exporter: SpanExporter;
  /** The longest `shutdown` waits for exports in flight before it gives up on them. Defaults to 5 seconds. */
  shutdownDrainMs?: number;
  now?: () => Date;
  /** Random bytes for ids; tests inject it. */
  randomHex?: (bytes: number) => string;
}

/** A tracer that keeps only allowlisted attributes: the processor of the privacy rule runs when a span ends. */
export class Tracer {
  private readonly exporter: SpanExporter;
  private readonly now: () => Date;
  private readonly randomHex: (bytes: number) => string;
  private readonly shutdownDrainMs: number;
  /** Asynchronous exports that have not settled yet: `shutdown` waits for them so the last spans are not lost. */
  private readonly pending = new Set<Promise<unknown>>();

  constructor(options: TracerOptions) {
    this.exporter = options.exporter;
    this.shutdownDrainMs = options.shutdownDrainMs ?? DEFAULT_SHUTDOWN_DRAIN_MS;
    this.now = options.now ?? (() => new Date());
    this.randomHex = options.randomHex ?? ((bytes) => randomBytes(bytes).toString('hex'));
  }

  /** Starts a span, in the trace of `parent` (a `traceparent` header or context) when it is valid, otherwise in a new trace. */
  startSpan(name: string, options: { parent?: string | TraceContext | undefined; attributes?: Readonly<Record<string, unknown>> } = {}): Span {
    const parent = typeof options.parent === 'string' ? parseTraceparent(options.parent) : options.parent;
    const context: TraceContext = { traceId: parent?.traceId ?? this.randomHex(16), spanId: this.randomHex(8), sampled: parent?.sampled ?? true };
    const startedAt = this.now();
    const attributes: Record<string, unknown> = { ...options.attributes };
    let ended = false;
    return {
      context,
      traceparent: formatTraceparent(context),
      setAttribute: (attribute, value) => {
        attributes[attribute] = value;
      },
      end: (status = 'OK') => {
        if (ended) return;
        ended = true;
        if (!context.sampled) return;
        const finished: FinishedSpan = {
          name,
          traceId: context.traceId,
          spanId: context.spanId,
          parentSpanId: parent?.spanId,
          startedAt,
          endedAt: this.now(),
          status,
          attributes: sanitizeSpanAttributes(attributes),
        };
        // An exporter that fails must never fail the request it describes.
        try {
          const outcome = this.exporter.export([finished]);
          if (outcome instanceof Promise) {
            const settled = outcome.catch(() => undefined).finally(() => this.pending.delete(settled));
            this.pending.add(settled);
          }
        } catch {
          // dropped on purpose
        }
      },
    };
  }

  /** Waits (a bounded time) for the exports in flight, then shuts the exporter down. */
  async shutdown(): Promise<void> {
    if (this.pending.size > 0) {
      let timer: NodeJS.Timeout | undefined;
      const expired = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.shutdownDrainMs);
      });
      try {
        await Promise.race([Promise.allSettled([...this.pending]), expired]);
      } finally {
        clearTimeout(timer);
      }
    }
    await this.exporter.shutdown?.();
  }
}

export interface OtlpExporterOptions {
  endpoint: string;
  serviceName: string;
  fetch?: typeof fetch;
}

const nanos = (date: Date): string => `${BigInt(date.getTime()) * 1_000_000n}`;

/** Sends spans to an OTLP/HTTP collector as JSON (`POST <endpoint>/v1/traces`). Attributes are already allowlisted. */
export class OtlpHttpSpanExporter implements SpanExporter {
  private readonly options: OtlpExporterOptions;
  private readonly send: typeof fetch;

  constructor(options: OtlpExporterOptions) {
    this.options = options;
    this.send = options.fetch ?? fetch;
  }

  async export(spans: readonly FinishedSpan[]): Promise<void> {
    const body = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: this.options.serviceName } }] },
          scopeSpans: [
            {
              scope: { name: 'machvon' },
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
                name: span.name,
                startTimeUnixNano: nanos(span.startedAt),
                endTimeUnixNano: nanos(span.endedAt),
                status: { code: span.status === 'OK' ? 1 : 2 },
                attributes: Object.entries(span.attributes).map(([key, value]) => ({
                  key,
                  value: typeof value === 'string' ? { stringValue: value } : typeof value === 'boolean' ? { boolValue: value } : { intValue: String(value) },
                })),
              })),
            },
          ],
        },
      ],
    };
    const response = await this.send(`${this.options.endpoint.replace(/\/+$/, '')}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`the trace collector answered ${response.status}`);
  }
}
