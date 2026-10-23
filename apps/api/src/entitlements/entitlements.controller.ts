import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { ControlDatabase, EntitlementStore } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { OperationId } from '../operation-id.decorator';
import { CurrentTenant } from '../tenant-context.decorator';
import { entitlementView } from './entitlement-view';
import type { EntitlementView } from './entitlement-view';

/**
 * What the tenant may do under its plan and license (SAS-25): `getMyEntitlements` for the tenant plane and
 * `getTenantEntitlements` for the control plane (permission system.tenant.read, checked by the policy guard).
 */
@Controller()
export class EntitlementsController {
  constructor(
    @Inject(EntitlementStore) private readonly store: EntitlementStore,
    @Inject(ControlDatabase) private readonly control: ControlDatabase,
  ) {}

  @Get('me/entitlements')
  @OperationId('getMyEntitlements')
  async mine(@CurrentTenant() tenant: TenantContext): Promise<EntitlementView> {
    return entitlementView(await this.store.current(tenant), new Date());
  }

  @Get('system/tenants/:tenantId/entitlements')
  @OperationId('getTenantEntitlements')
  async ofTenant(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<EntitlementView> {
    const known = await this.control.withControl((tx) => tx.query<{ id: string }>('select id from machvon.tenant where id = $1::uuid', [tenantId]));
    if (known.length === 0) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    const snapshot = await this.control.withTenantOf(tenantId, (tx) => this.store.currentIn(tx, tenantId));
    return entitlementView(snapshot, new Date());
  }
}
