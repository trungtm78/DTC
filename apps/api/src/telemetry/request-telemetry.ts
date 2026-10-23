import { randomUUID } from 'node:crypto';
import { asUuid, correlationOfTraceId, parseTraceparent, traceIdOfCorrelation } from '@machvon/kernel';
import type { Span, Tracer } from '@machvon/kernel';
import { TENANT_REQUEST_KEY } from '../tenant-context.decorator';

interface HttpRequest {
  method: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

interface HttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  on(event: 'finish' | 'close', listener: () => void): unknown;
}

type Next = (error?: unknown) => void;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Express middleware, first in the chain: gives every request one correlation id (the caller's `x-correlation-id`, else
 * the trace id of a valid `traceparent`, else a new one), starts the request span in the trace of that id, and ends it
 * when the response is done. The span carries only allowlisted attributes: tenant, operation, request and correlation
 * ids and the status code, never a path with an id, a header or a body.
 */
export function requestTelemetry(tracer: Tracer) {
  return (request: HttpRequest, response: HttpResponse, next: Next): void => {
    const incoming = parseTraceparent(first(request.headers.traceparent));
    const correlationId = asUuid(first(request.headers['x-correlation-id'])) ?? (incoming === undefined ? randomUUID() : correlationOfTraceId(incoming.traceId));
    request.headers['x-correlation-id'] = correlationId;
    const requestId = randomUUID();
    response.setHeader('x-correlation-id', correlationId);
    response.setHeader('x-request-id', requestId);
    const traceId = traceIdOfCorrelation(correlationId);
    const parent = incoming !== undefined && incoming.traceId === traceId ? incoming : traceId === undefined ? undefined : { traceId, spanId: '0000000000000001', sampled: true };
    const span: Span = tracer.startSpan(`${request.method} request`, { parent, attributes: { request_id: requestId, correlation_id: correlationId } });
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      const tenant = request[TENANT_REQUEST_KEY] as { tenantId?: string } | undefined;
      if (tenant?.tenantId !== undefined) span.setAttribute('tenant_id', tenant.tenantId);
      const operation = request.operationId;
      if (typeof operation === 'string') span.setAttribute('operation_id', operation);
      span.setAttribute('http.status_code', response.statusCode);
      span.end(response.statusCode >= 500 ? 'ERROR' : 'OK');
    };
    response.on('finish', finish);
    response.on('close', finish);
    next();
  };
}

/** Runs the handling of an outbox delivery inside a span of the trace of the request that wrote the event. */
export async function traceDelivery<T>(tracer: Tracer, delivery: { correlationId: string; tenantId: string; type: string }, work: () => Promise<T>): Promise<T> {
  const traceId = traceIdOfCorrelation(delivery.correlationId);
  const span = tracer.startSpan('outbox consume', {
    parent: traceId === undefined ? undefined : { traceId, spanId: '0000000000000002', sampled: true },
    attributes: { tenant_id: delivery.tenantId, correlation_id: delivery.correlationId, operation_id: delivery.type },
  });
  try {
    const result = await work();
    span.end('OK');
    return result;
  } catch (error) {
    span.end('ERROR');
    throw error;
  }
}
