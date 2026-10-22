import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { RoleStore, bumpScopeVersion } from '@machvon/db';
import { checkRoleDefinition } from '@machvon/kernel';
import type { EffectiveAccess } from '@machvon/kernel';
import { Command, Scope } from './command.decorator';
import { commandResult } from './command-result';
import type { CommandResult } from './command-result';
import type { CommandScope } from './command-scope';
import { CurrentAccess } from './current-access.decorator';
import { assertKnownPermissions, assertVerdict, parseRoleCreate, parseRoleUpdate } from './iam-dto';
import { OperationId } from './operation-id.decorator';

const TENANT_SCOPE = { kind: 'TENANT' } as const;

// Other controllers import the helper from here today; it lives in command-result.ts.
export { commandResult } from './command-result';
export type { CommandResult } from './command-result';

/**
 * Custom roles (ADM-03, BR-IAM-05 and BR-IAM-06). A role is tenant-wide, so the caller must hold `iam.role.manage`
 * on the whole tenant, and the role may not carry more rank or more permissions than the caller has.
 */
@Controller('roles')
export class RolesController {
  private readonly store = new RoleStore();

  @Post()
  @HttpCode(201)
  @OperationId('createCustomRole')
  @Command({ operation: 'createCustomRole' })
  async create(@Scope() scope: CommandScope, @CurrentAccess() access: EffectiveAccess, @Body() body: unknown): Promise<CommandResult> {
    const dto = parseRoleCreate(body);
    assertKnownPermissions(dto.permissions);
    assertVerdict(checkRoleDefinition({ grantor: access, permissions: dto.permissions, rank: dto.rank, scope: TENANT_SCOPE, now: new Date() }));
    const created = await this.store.createCustomRole(scope.tx, { ...dto, createdBy: scope.tenant.membershipId });
    await scope.audit({
      action: 'role.create',
      resourceType: 'role_definition',
      resourceId: created.id,
      diff: { code: dto.code, rank: dto.rank, permissions: dto.permissions, guest_allowed: dto.guestAllowed },
    });
    return commandResult(scope, 'CREATED', created.version, created.id);
  }

  @Put(':roleId')
  @HttpCode(200)
  @OperationId('updateCustomRole')
  @Command({ operation: 'updateCustomRole', versioned: true })
  async update(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: unknown,
  ): Promise<CommandResult> {
    const dto = parseRoleUpdate(body);
    assertKnownPermissions(dto.permissions);
    const role = await this.store.lockCustomRole(scope.tx, roleId, scope.expectedVersion ?? 0);
    // The caller needs authority over the higher of the old and the new rank, so a role cannot be edited from below.
    assertVerdict(
      checkRoleDefinition({ grantor: access, permissions: dto.permissions, rank: Math.max(role.rank, dto.rank ?? role.rank), scope: TENANT_SCOPE, now: new Date() }),
    );
    const updated = await this.store.updateCustomRole(scope.tx, roleId, { name: dto.name, permissions: dto.permissions, rank: dto.rank });
    if (updated.holderMembershipIds.length > 0) {
      await bumpScopeVersion(scope.tx, updated.holderMembershipIds);
      await scope.emit({
        aggregateType: 'role_definition',
        aggregateId: roleId,
        aggregateVersion: updated.version,
        type: 'iam.access.changed.v1',
        schemaVersion: 1,
        payload: { tenant_id: scope.tenant.tenantId, membership_ids: updated.holderMembershipIds },
        eventKey: `access-changed:${scope.requestId}`,
      });
    }
    await scope.audit({
      action: 'role.update',
      resourceType: 'role_definition',
      resourceId: roleId,
      reason: dto.reason,
      diff: {
        before: { rank: role.rank, permissions: role.permissions },
        after: { rank: dto.rank ?? role.rank, permissions: dto.permissions },
        holders: updated.holderMembershipIds.length,
      },
    });
    return commandResult(scope, 'UPDATED', updated.version, roleId);
  }
}
