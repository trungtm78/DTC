import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { TenantDatabase, scopePredicate } from '@machvon/db';
import { DomainError, effectivePermissions, holdsPermission } from '@machvon/kernel';
import type { EffectiveAccess, TenantContext } from '@machvon/kernel';
import { OperationId } from '../operation-id.decorator';
import { encodeCursor, parsePageRequest } from '../pagination';
import { ACCESS_REQUEST_KEY } from '../policy.guard';
import { CurrentTenant } from '../tenant-context.decorator';

interface MembershipRow {
  id: string;
  user_account_id: string;
  display_name: string;
  email: string;
  phone: string | null;
  status: string;
  organization_id: string;
  membership_type: string;
  valid_from: string;
  valid_until: string | null;
}

// The catalogue has no iam.member.read_pii (IAM section 6 names it): personal data is shown to those who manage members.
const PII_PERMISSION = 'iam.member.manage';
const READ_PERMISSION = PERMISSIONS.get_resources_membership;

// The view masks email and phone unless the transaction says the caller may read them. Row-level security limits it to
// the tenant of the transaction; the scope predicate limits it to the units the caller's grants reach.
const COLUMNS = `d.membership_id as id, d.user_account_id, d.display_name, d.email, d.phone, d.status, d.organization_id,
  d.membership_type, d.valid_from::text as valid_from, d.valid_until::text as valid_until`;
const FROM = `machvon.tenant_user_directory d join machvon.organization_unit ou on ou.tenant_id = d.tenant_id and ou.id = d.organization_id`;

const OptionalAccess = createParamDecorator((_data: unknown, context: ExecutionContext): EffectiveAccess | undefined =>
  context.switchToHttp().getRequest<{ [ACCESS_REQUEST_KEY]?: EffectiveAccess }>()[ACCESS_REQUEST_KEY],
);

function scopeClause(access: EffectiveAccess | undefined, firstParam: number): { sql: string; params: unknown[] } {
  if (access === undefined) return { sql: 'true', params: [] };
  return scopePredicate(access, READ_PERMISSION, new Date(), { unitPath: 'ou.path', unitId: 'ou.id' }, firstParam);
}

function mayReadPersonalData(access: EffectiveAccess | undefined): boolean {
  return access !== undefined && holdsPermission(effectivePermissions(access, new Date()), PII_PERMISSION);
}

/**
 * Membership reads (get_resources_membership and _id): the tenant directory with email and phone masked for callers
 * who do not manage members, limited to the units the caller's grants reach; another tenant's members never show.
 */
@Controller('resources/membership')
export class MembershipsController {
  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  @Get()
  @OperationId('get_resources_membership')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @OptionalAccess() access?: EffectiveAccess,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: MembershipRow[]; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    const scope = scopeClause(access, 4);
    const rows = await this.database.withTenant(tenant, async (tx) => {
      await tx.query("select set_config('app.can_read_pii', $1, true)", [String(mayReadPersonalData(access))]);
      return tx.query<MembershipRow>(
        `select ${COLUMNS} from ${FROM}
         where ($1::text is null or (d.display_name, d.membership_id) > ($1::text, $2::uuid)) and ${scope.sql}
         order by d.display_name, d.membership_id limit $3`,
        [request.after?.code ?? null, request.after?.id ?? null, request.limit + 1, ...scope.params],
      );
    });
    const items = rows.slice(0, request.limit);
    const last = items[items.length - 1];
    const hasMore = rows.length > request.limit && last !== undefined;
    return { items, next_cursor: hasMore ? encodeCursor({ code: last.display_name, id: last.id }) : null };
  }

  @Get(':id')
  @OperationId('get_resources_membership_id')
  async get(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @OptionalAccess() access?: EffectiveAccess): Promise<MembershipRow> {
    const scope = scopeClause(access, 2);
    const rows = await this.database.withTenant(tenant, async (tx) => {
      await tx.query("select set_config('app.can_read_pii', $1, true)", [String(mayReadPersonalData(access))]);
      return tx.query<MembershipRow>(`select ${COLUMNS} from ${FROM} where d.membership_id = $1 and ${scope.sql}`, [id, ...scope.params]);
    });
    const row = rows[0];
    // A member of another tenant, or outside the caller's scope, is indistinguishable from a missing one.
    if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return row;
  }
}
