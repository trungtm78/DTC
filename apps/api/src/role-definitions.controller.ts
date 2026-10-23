import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RoleStore, TenantDatabase } from '@machvon/db';
import type { RolePageAnchor, RoleRow } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { EffectiveAccess, TenantContext } from '@machvon/kernel';
import { CurrentAccess } from './current-access.decorator';
import { OperationId } from './operation-id.decorator';
import { encodeCursor, parsePageRequest } from './pagination';
import { roleVisibleTo } from './role-visibility';
import { CurrentTenant } from './tenant-context.decorator';

/** openapi.json RoleDefinitionView. */
interface RoleDefinitionView {
  id: string;
  code: string;
  name: string;
  rank: number;
  permissions: string[];
  is_system: boolean;
  guest_allowed: boolean;
  status: string;
  version: number;
}

// Roles are read in batches and filtered one by one, so a page of visible roles needs several batches when most are hidden.
const BATCH_SIZE = 50;

function toView(role: RoleRow): RoleDefinitionView {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    rank: role.rank,
    permissions: role.permissions,
    is_system: role.isSystem,
    guest_allowed: role.guestAllowed,
    status: role.status,
    version: role.version,
  };
}

function grantableFlag(value: unknown): boolean {
  if (value === undefined) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new DomainError('VALIDATION_FAILED', 422, 'grantable');
}

/**
 * Reads of role definitions for the role picker and the role matrix of ADM-03 (openapi.json
 * get_resources_role_definition and get_resources_role_definition_id, CR-ADM-05). What a caller sees follows
 * `roleVisibleTo`; a role the caller may not see is indistinguishable from a missing one.
 */
@Controller('resources/role_definition')
export class RoleDefinitionsController {
  private readonly store = new RoleStore();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  @Get()
  @OperationId('get_resources_role_definition')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
    @Query('grantable') grantable?: unknown,
  ): Promise<{ items: RoleDefinitionView[]; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    const options = { grantable: grantableFlag(grantable), now: new Date() };
    const visible = await this.database.withTenant(tenant, async (tx) => {
      const found: RoleRow[] = [];
      let after: RolePageAnchor | undefined = request.after;
      while (found.length <= request.limit) {
        const batch = await this.store.listRoles(tx, { after, limit: BATCH_SIZE });
        for (const role of batch) {
          after = { code: role.code, id: role.id };
          if (roleVisibleTo(access, role, options)) found.push(role);
          if (found.length > request.limit) break;
        }
        if (batch.length < BATCH_SIZE) break;
      }
      return found;
    });
    const items = visible.slice(0, request.limit);
    const last = items[items.length - 1];
    return { items: items.map(toView), next_cursor: visible.length > request.limit && last !== undefined ? encodeCursor({ code: last.code, id: last.id }) : null };
  }

  @Get(':id')
  @OperationId('get_resources_role_definition_id')
  async get(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: EffectiveAccess, @Param('id', ParseUUIDPipe) id: string): Promise<RoleDefinitionView> {
    const role = await this.database.withTenant(tenant, (tx) => this.store.findRole(tx, id));
    if (role === undefined || !roleVisibleTo(access, role, { grantable: false, now: new Date() })) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return toView(role);
  }
}
