import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditWriter, IdempotencyStore, NIL_RESOURCE_ID, TenantDatabase, enqueueOutbox } from '@machvon/db';
import type { StoredResponse } from '@machvon/db';
import { DomainError, asUuid, formatEtag, keyHashOf, parseIdempotencyKey, parseIfMatch, requestHashOf } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { from, lastValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import { COMMAND_METADATA_KEY, COMMAND_SCOPE_KEY } from './command.decorator';
import type { CommandOptions } from './command.decorator';
import type { CommandScope } from './command-scope';
import { tenantContextOf } from './tenant-context.decorator';

const HTTP_CODE_METADATA = '__httpCode__';
const REPLAYED_HEADER = 'Idempotency-Replayed';
const IN_PROGRESS_RETRY_AFTER = '2';

interface CommandRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  body: unknown;
  tenantContext?: unknown;
  [COMMAND_SCOPE_KEY]?: CommandScope;
}

interface CommandResponse {
  setHeader(name: string, value: string): unknown;
}

function versionOf(body: unknown): number | undefined {
  const version = typeof body === 'object' && body !== null ? (body as { version?: unknown }).version : undefined;
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 0 ? version : undefined;
}

function problemOf(error: DomainError): StoredResponse {
  return { kind: 'problem', code: error.code, status: error.status, detail: error.detail, extensions: error.extensions };
}

/**
 * Runs every @Command handler through the command pipeline (BR-PLT-01, BR-PLT-02): Idempotency-Key and
 * If-Match checks, one tenant transaction in which the handler's effects, its audit row, its outbox events
 * and the stored response commit together, and a settled idempotency record when the transaction rolls back.
 */
@Injectable()
export class CommandInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CommandInterceptor.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantDatabase) private readonly database: TenantDatabase,
    @Inject(IdempotencyStore) private readonly store: IdempotencyStore,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<CommandOptions | undefined>(COMMAND_METADATA_KEY, context.getHandler());
    if (options === undefined) return next.handle();
    return from(this.run(context, next, options));
  }

  private async run(context: ExecutionContext, next: CallHandler, options: CommandOptions): Promise<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<CommandRequest>();
    const response = http.getResponse<CommandResponse>();
    const tenant = tenantContextOf(request);
    const key = parseIdempotencyKey(request.headers['idempotency-key']);
    const ifMatchHeader = options.versioned === true ? request.headers['if-match'] : undefined;
    const expectedVersion = options.versioned === true ? parseIfMatch(ifMatchHeader) : null;
    const requestHash = requestHashOf({
      body: request.body,
      pathParams: request.params,
      ifMatch: typeof ifMatchHeader === 'string' ? ifMatchHeader : null,
    });

    const begin = await this.store.begin(tenant, {
      operation: options.operation,
      keyHash: keyHashOf(key),
      requestHash,
      ttl: options.ttl ?? 'standard',
    });
    switch (begin.kind) {
      case 'conflict':
        throw new DomainError('IDEMPOTENCY_CONFLICT', 409);
      case 'in_progress':
        throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 409, undefined, { headers: { 'Retry-After': IN_PROGRESS_RETRY_AFTER } });
      case 'replay':
        if (begin.response.kind === 'problem') {
          const { code, status, detail, extensions } = begin.response;
          throw new DomainError(code, status, detail, { extensions, headers: { [REPLAYED_HEADER]: 'true' } });
        }
        response.setHeader(REPLAYED_HEADER, 'true');
        this.setEtag(response, begin.response.body);
        return begin.response.body;
      case 'started':
        break;
    }

    const requestId = randomUUID();
    const correlationId = asUuid(request.headers['x-correlation-id']) ?? randomUUID();
    const httpStatus =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ?? (request.method === 'POST' ? 201 : 200);
    try {
      const body = await this.database.withTenant(tenant, async (tx) => {
        let audited = 0;
        const scope: CommandScope = {
          tx,
          tenant,
          requestId,
          correlationId,
          expectedVersion,
          audit: async (entry) => {
            audited += 1;
            return this.audit.recordInTx(tx, tenant.membershipId, { ...entry, correlationId, requestId });
          },
          emit: (event) => enqueueOutbox(tx, { ...event, correlationId }),
        };
        request[COMMAND_SCOPE_KEY] = scope;
        const result: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
        if (audited === 0) throw new Error(`command ${options.operation} wrote no audit entry`);
        await this.store.completeInTx(tx, begin.recordId, { httpStatus, response: { kind: 'success', body: result } });
        return result;
      });
      this.setEtag(response, body);
      return body;
    } catch (error) {
      await this.settle(tenant, begin.recordId, options.operation, { requestId, correlationId }, error);
      throw error;
    }
  }

  private setEtag(response: CommandResponse, body: unknown): void {
    const version = versionOf(body);
    if (version !== undefined) response.setHeader('ETag', formatEtag(version));
  }

  // The business transaction rolled back: a 4xx answer is final and replays; anything else may be retried.
  private async settle(
    tenant: TenantContext,
    recordId: string,
    operation: string,
    ids: { requestId: string; correlationId: string },
    error: unknown,
  ): Promise<void> {
    try {
      if (error instanceof DomainError && error.status >= 400 && error.status < 500) {
        if (error.status === 403) {
          await this.audit.recordDenied(tenant, {
            action: `command.denied:${operation}`,
            resourceType: 'command',
            resourceId: NIL_RESOURCE_ID,
            diff: { operation, code: error.code },
            ...ids,
          });
        }
        await this.store.finishOutsideTx(tenant, recordId, { retryable: false, httpStatus: error.status, response: problemOf(error) });
      } else {
        await this.store.finishOutsideTx(tenant, recordId, { retryable: true });
      }
    } catch (settleError) {
      // The caller still gets the original failure; the record stays IN_PROGRESS until its lock expires.
      this.logger.error(settleError, ids.correlationId);
    }
  }
}
