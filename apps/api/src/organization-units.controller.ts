import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { TenantDatabase, scopePredicate } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { EffectiveAccess, TenantContext } from '@machvon/kernel';
import { OperationId } from './operation-id.decorator';
import { encodeCursor, parsePageRequest } from './pagination';
import { ACCESS_REQUEST_KEY } from './policy.guard';
import { CurrentTenant } from './tenant-context.decorator';

interface OrganizationUnitRow {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  valid_from: string;
  valid_until: string | null;
}

// Row-level security, not a WHERE clause, confines these queries to the tenant of the transaction.
const COLUMNS = 'id, code, name, parent_id, valid_from::text as valid_from, valid_until::text as valid_until';
// Keyset page: rows after the cursor in (code, id) order that the caller's scope contains; one extra row tells whether
// another page exists. `scope` is the SQL predicate of the caller's grants, numbered after the three page parameters.
const listPageSql = (scope: string): string => `select ${COLUMNS} from machvon.organization_unit
  where ($1::text is null or (code, id) > ($1::text, $2::uuid)) and ${scope}
  order by code, id limit $3`;

const READ_PERMISSION = PERMISSIONS.get_resources_organization_unit;

/** The scope predicate of the caller on `path`/`id`; `true` when no policy guard ran (RLS alone then bounds the tenant). */
function scopeClause(access: EffectiveAccess | undefined, firstParam: number): { sql: string; params: unknown[] } {
  if (access === undefined) return { sql: 'true', params: [] };
  return scopePredicate(access, READ_PERMISSION, new Date(), { unitPath: 'path', unitId: 'id' }, firstParam);
}

/** The EffectiveAccess the policy guard decided on, or undefined when the application runs without the guard. */
const OptionalAccess = createParamDecorator((_data: unknown, context: ExecutionContext): EffectiveAccess | undefined =>
  context.switchToHttp().getRequest<{ [ACCESS_REQUEST_KEY]?: EffectiveAccess }>()[ACCESS_REQUEST_KEY],
);

/**
 * Read-only organization unit endpoints (openapi.json: get_resources_organization_unit and
 * get_resources_organization_unit_id). Every query runs inside TenantDatabase.withTenant.
 */
@Controller('resources/organization_unit')
export class OrganizationUnitsController {
  private readonly database: TenantDatabase;

  constructor(@Inject(TenantDatabase) database: TenantDatabase) {
    this.database = database;
  }

  @Get()
  @OperationId('get_resources_organization_unit')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @OptionalAccess() access?: EffectiveAccess,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: OrganizationUnitRow[]; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    const scope = scopeClause(access, 4);
    const rows = await this.database.withTenant(tenant, (tx) =>
      tx.query<OrganizationUnitRow>(listPageSql(scope.sql), [request.after?.code ?? null, request.after?.id ?? null, request.limit + 1, ...scope.params]),
    );
    const items = rows.slice(0, request.limit);
    const last = items[items.length - 1];
    const hasMore = rows.length > request.limit && last !== undefined;
    return { items, next_cursor: hasMore ? encodeCursor({ code: last.code, id: last.id }) : null };
  }

  @Get(':id')
  @OperationId('get_resources_organization_unit_id')
  async get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @OptionalAccess() access?: EffectiveAccess,
  ): Promise<OrganizationUnitRow> {
    const scope = scopeClause(access, 2);
    const rows = await this.database.withTenant(tenant, (tx) =>
      tx.query<OrganizationUnitRow>(`select ${COLUMNS} from machvon.organization_unit where id = $1 and ${scope.sql}`, [id, ...scope.params]),
    );
    const row = rows[0];
    // A unit of another tenant, or outside the caller's scope, is indistinguishable from a missing one.
    if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return row;
  }
}
