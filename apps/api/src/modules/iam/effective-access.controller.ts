import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { EntitlementStore, MyAccessStore, TenantDatabase } from '@machvon/db';
import type { TenantContext } from '@machvon/kernel';
import { OperationId } from '../../operation-id.decorator';
import { CurrentTenant } from '../../tenant-context.decorator';
import { effectiveAccessView } from './effective-access-view';
import type { EffectiveAccessDto } from './effective-access-view';

/**
 * IAM-09 (getMyEffectiveAccess): the grants, scopes and delegations of the caller. The membership comes from the verified
 * token and from nothing the request says, so the answer can only ever be the caller's own; the policy guard has already
 * judged `session.self`. The entitlement hash is added where the entitlement store is wired.
 */
@Controller('me')
export class EffectiveAccessController {
  private readonly store = new MyAccessStore();

  constructor(
    @Inject(TenantDatabase) private readonly database: TenantDatabase,
    @Optional() @Inject(EntitlementStore) private readonly entitlements?: EntitlementStore,
  ) {}

  @Get('effective-access')
  @OperationId('getMyEffectiveAccess')
  async mine(@CurrentTenant() tenant: TenantContext): Promise<EffectiveAccessDto> {
    const now = new Date();
    const found = await this.database.withTenant(tenant, async (tx) => ({
      scopeVersion: await this.store.scopeVersionOf(tx, tenant.membershipId),
      grants: await this.store.grants(tx, tenant.membershipId),
      delegations: await this.store.delegationsTo(tx, tenant.membershipId),
    }));
    const snapshot = await this.entitlements?.current(tenant);
    return effectiveAccessView({ membershipId: tenant.membershipId, ...found, entitlementHash: snapshot?.hash, now });
  }
}
