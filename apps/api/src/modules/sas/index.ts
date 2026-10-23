import { TenantBootstrapStore, ThemeStore } from '@machvon/db';
import { defineModule } from '../module-descriptor';
import { TenantOwnerController } from './tenant-owner.controller';
import { TenantStateController } from './tenant-state.controller';
import { ThemeController } from './theme.controller';

/**
 * SAS, the system administration of the control plane: the tenant lifecycle commands of ST-SAS-004, the owner assignment
 * of ST-SAS-006 and the tenant themes of ST-SAS-005. The tenant registry of ST-SAS-001 stays in apps/api/src/system-tenants.controller.ts; the module is
 * active wherever the registry is.
 */
export const sasModule = defineModule({
  code: 'SAS',
  controllers: [TenantStateController, TenantOwnerController, ThemeController],
  providers: [
    { provide: ThemeStore, useFactory: () => new ThemeStore() },
    { provide: TenantBootstrapStore, useFactory: () => new TenantBootstrapStore() },
  ],
  enabled: (options) => options.control !== undefined,
});
