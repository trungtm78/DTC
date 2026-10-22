import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { TenantDatabase, bumpScopeVersion } from '@machvon/db';
import { RoleStore } from '@machvon/db/src/role-store';
import type { GrantRow, ResolvedScope, RoleRow } from '@machvon/db/src/role-store';
import { DomainError, checkGrant, effectivePermissions, holdsPermission, maxRank } from '@machvon/kernel';
import type { AntiEscalationResult, EffectiveAccess, TenantContext } from '@machvon/kernel';
import { Command, Scope } from './command.decorator';
import type { CommandScope } from './command-scope';
import { CurrentAccess } from './current-access.decorator';
import { assertVerdict, parseGrantCreate, parseReasonOnly } from './iam-dto';
import { OperationId } from './operation-id.decorator';
import { encodeCursor, parsePageRequest } from './pagination';
import { commandResult } from './roles.controller';
import type { CommandResult } from './roles.controller';
import { CurrentTenant } from './tenant-context.decorator';

const GRANT_PERMISSION = 'iam.role.grant';

interface GrantDto {
  id: string;
  membership_id: string;
  role_id: string;
  role_code: string;
  scope_kind: string;
  scope_ref_ids: string[];
  status: string;
  effective_from: string;
  effective_until: string | null;
  granted_by: string;
  grant_reason: string;
  version: number;
}

function toDto(grant: GrantRow): GrantDto {
  return {
    id: grant.id,
    membership_id: grant.membershipId,
    role_id: grant.roleId,
    role_code: grant.roleCode,
    scope_kind: grant.scopeKind,
    scope_ref_ids: grant.scopeRefIds,
    status: grant.status,
    effective_from: grant.effectiveFrom,
    effective_until: grant.effectiveUntil,
    granted_by: grant.grantedBy,
    grant_reason: grant.grantReason,
    version: grant.version,
  };
}

/**
 * BR-IAM-05 for a role of a given rank and permissions over a resolved scope. A PROJECT or CONTRACT scope cannot be
 * proved inside a unit subtree from its ids, so when it is out of range as asked, the owner units of the project or
 * contract are checked instead: a grantor over the unit subtree may grant on the projects and contracts below it,
 * while a grantor whose own grants are PROJECT or CONTRACT scopes can only re-grant ids they hold.
 */
function authorise(
  access: EffectiveAccess,
  recipientMembershipId: string,
  role: Pick<RoleRow, 'rank' | 'permissions'>,
  resolved: ResolvedScope,
): AntiEscalationResult {
  const now = new Date();
  const input = { grantor: access, recipientMembershipId, role: { rank: role.rank, permissions: role.permissions }, now };
  const asked = checkGrant({ ...input, requestedScope: resolved.scope });
  if (asked.ok || asked.code !== 'SCOPE_OUT_OF_GRANTOR_RANGE' || resolved.ownerUnitScope === undefined) return asked;
  return checkGrant({ ...input, requestedScope: resolved.ownerUnitScope });
}

/**
 * Role grants (ADM-03, BR-IAM-05 to BR-IAM-07). Every command locks the recipient first, so grants and revocations
 * for one member serialise, writes the audit row and the access-changed event in the command transaction, and
 * raises the recipient's scope_version so the next request re-evaluates access.
 */
@Controller('role-grants')
export class RoleGrantsController {
  private readonly store = new RoleStore();

  @Post()
  @HttpCode(201)
  @OperationId('grantRole')
  @Command({ operation: 'grantRole' })
  async grant(@Scope() scope: CommandScope, @CurrentAccess() access: EffectiveAccess, @Body() body: unknown): Promise<CommandResult> {
    const dto = parseGrantCreate(body);
    const recipient = await this.store.lockMembership(scope.tx, dto.membershipId);
    if (recipient === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (recipient.status !== 'Active' || recipient.lapsed) throw new DomainError('MEMBERSHIP_INACTIVE', 403);
    const role = await this.store.findRole(scope.tx, dto.roleId);
    if (role === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (role.status !== 'Active') throw new DomainError('VALIDATION_FAILED', 422, 'role_id');
    const resolved = await this.store.resolveScope(scope.tx, dto.scopeKind, dto.scopeRefIds);
    if (resolved === undefined) throw new DomainError('VALIDATION_FAILED', 422, 'scope_ref_ids');
    // BR-IAM-08: a guest contractor only receives guest roles, and only on contracts.
    if (recipient.membershipType === 'GUEST_CONTRACTOR' && (!role.guestAllowed || dto.scopeKind !== 'CONTRACT')) {
      throw new DomainError('GUEST_SCOPE_INVALID', 422);
    }
    assertVerdict(authorise(access, dto.membershipId, role, resolved));

    const created = await this.store.insertGrant(scope.tx, {
      membershipId: dto.membershipId,
      roleId: dto.roleId,
      scopeKind: dto.scopeKind,
      scopeRefIds: dto.scopeRefIds,
      paths: resolved.paths,
      effectiveFrom: dto.effectiveFrom,
      effectiveUntil: dto.effectiveUntil,
      grantedBy: scope.tenant.membershipId,
      reason: dto.reason,
    });
    await this.announceAccessChange(scope, dto.membershipId);
    await scope.audit({
      action: 'grant.create',
      resourceType: 'role_grant',
      resourceId: created.id,
      reason: dto.reason,
      diff: { membership_id: dto.membershipId, role_code: role.code, scope_kind: dto.scopeKind, scope_ref_ids: dto.scopeRefIds },
    });
    return commandResult(scope, 'CREATED', created.version, created.id);
  }

  @Post(':grantId/revoke')
  @HttpCode(200)
  @OperationId('revokeRoleGrant')
  @Command({ operation: 'revokeRoleGrant', versioned: true })
  async revoke(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() body: unknown,
  ): Promise<CommandResult> {
    const dto = parseReasonOnly(body);
    // Lock order is always membership, then grant, as in grantRole, so the two commands cannot deadlock.
    const peek = await this.store.getGrant(scope.tx, grantId);
    if (peek === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (peek.membershipId === scope.tenant.membershipId) throw new DomainError('SELF_ACTION_DENIED', 403);
    await this.store.lockMembership(scope.tx, peek.membershipId);
    const grant = await this.store.lockGrant(scope.tx, grantId, scope.expectedVersion ?? 0);
    const role = await this.store.findRole(scope.tx, grant.roleId);
    const resolved = await this.store.resolveScope(scope.tx, grant.scopeKind, grant.scopeRefIds);
    if (role === undefined || resolved === undefined) throw new DomainError('VALIDATION_FAILED', 422, 'grant');
    assertVerdict(authorise(access, grant.membershipId, role, resolved));
    // The actor must outrank everything the member holds, not only the role being revoked.
    const reach = resolved.ownerUnitScope ?? resolved.scope;
    if (maxRank(access, new Date(), reach) <= (await this.store.highestRankOf(scope.tx, grant.membershipId))) {
      throw new DomainError('ROLE_ESCALATION_DENIED', 403);
    }

    const revoked = await this.store.revokeGrant(scope.tx, grant, scope.tenant.membershipId, dto.reason);
    await this.announceAccessChange(scope, grant.membershipId);
    await scope.audit({
      action: 'grant.revoke',
      resourceType: 'role_grant',
      resourceId: grantId,
      reason: dto.reason,
      diff: { membership_id: grant.membershipId, role_code: grant.roleCode, scope_kind: grant.scopeKind },
    });
    return commandResult(scope, 'REVOKED', revoked.version, grantId);
  }

  private async announceAccessChange(scope: CommandScope, membershipId: string): Promise<void> {
    await bumpScopeVersion(scope.tx, [membershipId]);
    await scope.emit({
      aggregateType: 'membership',
      aggregateId: membershipId,
      aggregateVersion: await this.store.scopeVersionOf(scope.tx, membershipId),
      type: 'iam.access.changed.v1',
      schemaVersion: 1,
      payload: { tenant_id: scope.tenant.tenantId, membership_ids: [membershipId] },
      eventKey: `access-changed:${scope.requestId}`,
    });
  }
}

/**
 * Reads of role grants (openapi.json get_resources_role_grant and get_resources_role_grant_id): a caller sees every
 * grant of the tenant when they hold `iam.role.grant`, otherwise only their own.
 */
@Controller('resources/role_grant')
export class RoleGrantReadsController {
  private readonly store = new RoleStore();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  @Get()
  @OperationId('get_resources_role_grant')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: GrantDto[]; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    const rows = await this.database.withTenant(tenant, (tx) =>
      this.store.listGrants(tx, { after: request.after?.id, limit: request.limit, membershipId: this.visibleTo(access, tenant) }),
    );
    const items = rows.slice(0, request.limit);
    const last = items[items.length - 1];
    return { items: items.map(toDto), next_cursor: rows.length > request.limit && last !== undefined ? encodeCursor({ code: '', id: last.id }) : null };
  }

  @Get(':id')
  @OperationId('get_resources_role_grant_id')
  async get(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: EffectiveAccess, @Param('id', ParseUUIDPipe) id: string): Promise<GrantDto> {
    const grant = await this.database.withTenant(tenant, (tx) => this.store.getGrant(tx, id));
    // A grant the caller may not see is indistinguishable from a missing one.
    if (grant === undefined || (this.visibleTo(access, tenant) !== undefined && grant.membershipId !== tenant.membershipId)) {
      throw new DomainError('RESOURCE_NOT_FOUND', 404);
    }
    return toDto(grant);
  }

  // undefined means every grant of the tenant; otherwise the membership whose grants the caller may read.
  private visibleTo(access: EffectiveAccess, tenant: TenantContext): string | undefined {
    return holdsPermission(effectivePermissions(access, new Date()), GRANT_PERMISSION) ? undefined : tenant.membershipId;
  }
}
