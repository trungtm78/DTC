import { Controller, Get, Inject, Query } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { MemberStore, TenantDatabase, scopePredicate } from '@machvon/db';
import type { ContractSummary } from '@machvon/db';
import type { EffectiveAccess, TenantContext } from '@machvon/kernel';
import { CurrentAccess } from '../../current-access.decorator';
import { OperationId } from '../../operation-id.decorator';
import { encodeCursor, parsePageRequest } from '../../pagination';
import { CurrentTenant } from '../../tenant-context.decorator';

const READ_PERMISSION = PERMISSIONS.get_resources_contract;
// The reach is the SQL over the owner unit of the contract; the first three parameters of the query are the page.
const FIRST_REACH_PARAM = 4;

interface ContractView {
  id: string;
  code: string;
  status: string;
  contractor_id: string;
  contractor_name: string | null;
  project_id: string;
  owner_unit_id: string;
  completion_due: string | null;
}

function toView(contract: ContractSummary): ContractView {
  return {
    id: contract.id,
    code: contract.code,
    status: contract.status,
    contractor_id: contract.contractorId,
    contractor_name: contract.contractorName,
    project_id: contract.projectId,
    owner_unit_id: contract.ownerUnitId,
    completion_due: contract.completionDue,
  };
}

/**
 * The contracts the guest invitation of ADM-17 picks from (openapi.json get_resources_contract, CR-ADM-07). It is the
 * minimum of the CTR module (R1) that ADM needs: the contracts whose owner unit lies in the scope of the caller's
 * `contract.read` grants, each with its contractor, so the picker can group by contractor. PROJECT and CONTRACT scoped
 * grants cannot be judged from the owner unit and add nothing, as in the other scoped reads.
 */
@Controller('resources/contract')
export class ContractPickerController {
  private readonly members = new MemberStore();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  @Get()
  @OperationId('get_resources_contract')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: ContractView[]; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    const reach = scopePredicate(access, READ_PERMISSION, new Date(), { unitPath: 'cu.path', unitId: 'cu.id' }, FIRST_REACH_PARAM);
    const rows = await this.database.withTenant(tenant, (tx) => this.members.contractsInReach(tx, { limit: request.limit + 1, after: request.after, reach }));
    const items = rows.slice(0, request.limit);
    const last = items[items.length - 1];
    return { items: items.map(toView), next_cursor: rows.length > request.limit && last !== undefined ? encodeCursor({ code: last.code, id: last.id }) : null };
  }
}
