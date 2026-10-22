import { Controller, Get, Inject, Param } from '@nestjs/common';
import { DomainError } from '@machvon/kernel';
import type { Pool } from 'pg';
import { OperationId } from '../../src/operation-id.decorator';

export const LEAKY_POOL = Symbol('LEAKY_POOL');

/**
 * Negative control: reads organization units by id with a plain pool and no tenant context
 * (no TenantDatabase.withTenant). With a pool whose role bypasses row-level security (a superuser) it
 * leaks across tenants; with machvon_app the database still returns nothing.
 */
@Controller('resources/organization_unit')
export class LeakyOrganizationUnitsController {
  private readonly pool: Pool;

  constructor(@Inject(LEAKY_POOL) pool: Pool) {
    this.pool = pool;
  }

  @Get(':id')
  @OperationId('get_resources_organization_unit_id')
  async get(@Param('id') id: string): Promise<unknown> {
    const result = await this.pool.query('select id, code, name from machvon.organization_unit where id = $1', [id]);
    const row: unknown = result.rows[0];
    if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return row;
  }
}

/** Second negative control: an implemented id-bearing operation that no foreign-id case covers. */
@Controller('resources/membership')
export class UncoveredMembershipController {
  @Get(':id')
  @OperationId('get_resources_membership_id')
  get(@Param('id') id: string): unknown {
    return { id };
  }
}
