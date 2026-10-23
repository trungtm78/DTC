import { TenantBootstrapStore, ThemeStore } from '@machvon/db';
import { defineModule } from '../module-descriptor';
import { TenantOwnerController } from './tenant-owner.controller';
import { TenantStateController } from './tenant-state.controller';
import { TenantThemeController } from './tenant-theme.controller';
import { ThemeController } from './theme.controller';

/**
 * SAS, the system administration of the control plane: the tenant lifecycle commands of ST-SAS-004, the owner assignment
 * of ST-SAS-006 and the tenant themes of ST-SAS-005. The tenant registry of ST-SAS-001 stays in apps/api/src/system-tenants.controller.ts.
 * The commands and the System Admin reads need the control plane; the read of the published theme by a member of the tenant
 * (getMyPublishedTheme) needs only the tenant database and is active without it.
 */
export const sasModule = defineModule({
  code: 'SAS',
  controllers: [TenantThemeController],
  providers: [{ provide: ThemeStore, useFactory: () => new ThemeStore() }],
  controlPlane: {
    controllers: [TenantStateController, TenantOwnerController, ThemeController],
    providers: [{ provide: TenantBootstrapStore, useFactory: () => new TenantBootstrapStore() }],
  },
});
