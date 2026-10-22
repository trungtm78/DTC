import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { TenantDatabase } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { OperationId } from './operation-id.decorator';
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
const LIST_LIMIT = 200;

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
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ items: OrganizationUnitRow[]; next_cursor: null }> {
    const items = await this.database.withTenant(tenant, (tx) =>
      tx.query<OrganizationUnitRow>(`select ${COLUMNS} from machvon.organization_unit order by code, id limit ${LIST_LIMIT}`),
    );
    return { items, next_cursor: null };
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
