import { Controller, Get, Inject, Query } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { SearchProjectionStore, TenantDatabase } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { EffectiveAccess, TenantContext } from '@machvon/kernel';
import { CurrentAccess } from '../../current-access.decorator';
import { OperationId } from '../../operation-id.decorator';
import { parsePageRequest } from '../../pagination';
import { CurrentTenant } from '../../tenant-context.decorator';

const SEARCH_PERMISSION = PERMISSIONS.searchGlobal;
// openapi.json: q has minLength 2 and maxLength 200 (counted in characters, not UTF-16 units).
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;

function invalid(field: 'q' | 'cursor'): DomainError {
  return new DomainError('VALIDATION_FAILED', 422, field);
}

// PostgreSQL text cannot hold NUL, and a lone surrogate has no UTF-8 form.
function isDatabaseText(value: string): boolean {
  return !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value;
}

function parseQuery(value: unknown): string {
  if (typeof value !== 'string' || !isDatabaseText(value)) throw invalid('q');
  const length = Array.from(value).length;
  if (length < MIN_QUERY_LENGTH || length > MAX_QUERY_LENGTH) throw invalid('q');
  return value;
}

/**
 * Global search within the scope of the caller (IAM-07). The query runs on the projection of the tenant and keeps only
 * the documents whose owner unit lies in the scope of the caller's `search.use` grants, before ranking. A hit shows what
 * its classification allows; opening it calls the detail API, which checks the permission a second time. The page has
 * no total: a count would show how much exists outside the scope.
 */
@Controller()
export class SearchController {
  private readonly database: TenantDatabase;
  private readonly store = new SearchProjectionStore();

  constructor(@Inject(TenantDatabase) database: TenantDatabase) {
    this.database = database;
  }

  @Get('search')
  @OperationId('searchGlobal')
  async search(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Query('q') q?: unknown,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: Array<Record<string, unknown>>; next_cursor: string | null }> {
    const query = parseQuery(q);
    const { limit: size } = parsePageRequest(limit, undefined);
    if (cursor !== undefined && typeof cursor !== 'string') throw invalid('cursor');
    const page = await this.database.withTenant(tenant, (tx) =>
      this.store.search(tx, { tenantId: tenant.tenantId, access, permission: SEARCH_PERMISSION, now: new Date(), query, limit: size, cursor }),
    );
    return {
      items: page.items.map((hit) => ({
        entity_type: hit.entityType,
        entity_id: hit.entityId,
        title: hit.title,
        classification: hit.classification,
        snippet: hit.snippet,
      })),
      next_cursor: page.nextCursor,
    };
  }
}
