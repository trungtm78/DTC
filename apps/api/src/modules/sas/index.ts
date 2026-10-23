import { defineModule } from '../module-descriptor';
import { TenantStateController } from './tenant-state.controller';

/**
 * SAS, the system administration of the control plane: the tenant lifecycle commands of ST-SAS-004. The tenant registry
 * of ST-SAS-001 stays in apps/api/src/system-tenants.controller.ts; the module is active wherever the registry is.
 */
export const sasModule = defineModule({
  code: 'SAS',
  controllers: [TenantStateController],
  enabled: (options) => options.control !== undefined,
});
