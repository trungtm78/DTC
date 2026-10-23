import { Controller, Get, Inject } from '@nestjs/common';
import { TenantDatabase, ThemeStore } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import type { Schemas } from '../../contract-types';
import { OperationId } from '../../operation-id.decorator';
import { CurrentTenant } from '../../tenant-context.decorator';
import { versionView } from './theme-view';

/**
 * The tenant side of the theme (ST-SAS-005): a member reads the published version of their own tenant. It needs the tenant
 * database only, so it stays active where the control plane is not configured; the System Admin side is ThemeController.
 */
@Controller()
export class TenantThemeController {
  constructor(
    @Inject(ThemeStore) private readonly store: ThemeStore,
    @Inject(TenantDatabase) private readonly tenants: TenantDatabase,
  ) {}

  /** getMyPublishedTheme: the published version of the caller's own tenant, for any member (`tenant.theme.read`). */
  @Get('me/tenant/theme')
  @OperationId('getMyPublishedTheme')
  async mine(@CurrentTenant() tenant: TenantContext): Promise<Schemas['TenantThemeVersion']> {
    const published = await this.tenants.withTenant(tenant, (tx) => this.store.currentVersion(tx, tenant.tenantId));
    if (published === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return versionView(published);
  }
}
