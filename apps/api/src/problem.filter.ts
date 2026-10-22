import { randomUUID } from 'node:crypto';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import { asUuid, DomainError } from '@machvon/kernel';
import type { RegisteredError } from '@machvon/kernel';

const INTERNAL_ERROR = 'INTERNAL_ERROR';
const VALIDATION_FAILED = 'VALIDATION_FAILED';
const CORRELATION_HEADER = 'x-correlation-id';
const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

// Nearest registered code per HTTP status; any other 4xx is a validation failure.
const CODE_BY_HTTP_STATUS: Readonly<Record<number, string>> = {
  401: 'SESSION_EXPIRED',
  403: 'SCOPE_DENIED',
  404: 'RESOURCE_NOT_FOUND',
  429: 'RATE_LIMIT',
};

interface ProblemRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface ProblemResponse {
  status(code: number): ProblemResponse;
  setHeader(name: string, value: string): unknown;
  send(body: string): unknown;
}

interface ErrorLogger {
  error(...args: unknown[]): void;
}

interface Problem {
  status: number;
  code: string;
  detail: string | undefined;
}

function correlationIdOf(request: ProblemRequest): string {
  return asUuid(request.headers[CORRELATION_HEADER]) ?? randomUUID();
}

/**
 * Renders every failure as RFC 9457 `application/problem+json`. The body only ever carries the
 * registered code, i18n keys, the status, the correlation id and, for DomainError, its safe detail:
 * messages, stacks, SQL text and constraint names of other exceptions stay in the server log.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(
    private readonly registry: ReadonlyMap<string, RegisteredError>,
    private readonly logger: ErrorLogger = new Logger(ProblemFilter.name),
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ProblemRequest>();
    const response = http.getResponse<ProblemResponse>();
    const correlationId = correlationIdOf(request);
    const problem = this.classify(exception, correlationId);
    const body: Record<string, unknown> = {
      type: `urn:machvon:error:${problem.code}`,
      title: `error.${problem.code}.title`,
      status: problem.status,
      code: problem.code,
    };
    if (problem.detail !== undefined) body.detail = problem.detail;
    body.correlationId = correlationId;

    response.setHeader('Content-Type', PROBLEM_CONTENT_TYPE);
    response.setHeader('X-Correlation-Id', correlationId);
    response.status(problem.status).send(JSON.stringify(body));
  }

  private classify(exception: unknown, correlationId: string): Problem {
    if (exception instanceof DomainError) {
      return { status: exception.status, code: exception.code, detail: exception.detail };
    }
    if (exception instanceof HttpException) {
      const mapped = this.mapHttpStatus(exception.getStatus());
      if (mapped !== undefined) return { ...mapped, detail: `error.${mapped.code}.detail` };
    }
    this.logger.error(exception, correlationId);
    return { status: 500, code: INTERNAL_ERROR, detail: `error.${INTERNAL_ERROR}.detail` };
  }

  private mapHttpStatus(httpStatus: number): { status: number; code: string } | undefined {
    if (httpStatus < 400 || httpStatus >= 500) return undefined;
    const code = CODE_BY_HTTP_STATUS[httpStatus] ?? VALIDATION_FAILED;
    const registered = this.registry.get(code);
    return registered === undefined ? undefined : { status: registered.status, code };
  }
}
