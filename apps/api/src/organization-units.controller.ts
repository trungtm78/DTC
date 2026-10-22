import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { TenantDatabase } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { OperationId } from './operation-id.decorator';
import { encodeCursor, parsePageRequest } from './pagination';
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
// Keyset page: rows after the cursor in (code, id) order; one extra row tells whether another page exists.
const LIST_PAGE_SQL = `select ${COLUMNS} from machvon.organization_unit
  where ($1::text is null or (code, id) > ($1::text, $2::uuid))
  order by code, id limit $3`;

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
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: OrganizationUnitRow[]; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    const rows = await this.database.withTenant(tenant, (tx) =>
      tx.query<OrganizationUnitRow>(LIST_PAGE_SQL, [request.after?.code ?? null, request.after?.id ?? null, request.limit + 1]),
    );
    const items = rows.slice(0, request.limit);
    const last = items[items.length - 1];
    const hasMore = rows.length > request.limit && last !== undefined;
    return { items, next_cursor: hasMore ? encodeCursor({ code: last.code, id: last.id }) : null };
  }

  @Get(':id')
  @OperationId('get_resources_organization_unit_id')
  async get(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<OrganizationUnitRow> {
    const rows = await this.database.withTenant(tenant, (tx) =>
      tx.query<OrganizationUnitRow>(`select ${COLUMNS} from machvon.organization_unit where id = $1`, [id]),
    );
    const row = rows[0];
    // A unit of another tenant is invisible to the transaction, so it is indistinguishable from a missing one.
    if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return row;
  }
}
