import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { bumpScopeVersion, membershipsAffectedByUnits } from '@machvon/db';
import { createUnit, loadUnit, lockUnitTree, moveUnit, subtreeUnitIds, updateUnit } from '@machvon/db/src/org-unit-tree';
import type { UnitView } from '@machvon/db/src/org-unit-tree';
import { DomainError, effectivePermissions, holdsPermission } from '@machvon/kernel';
import type { EffectiveAccess } from '@machvon/kernel';
import { Command, Scope } from './command.decorator';
import type { CommandScope } from './command-scope';
import { CurrentAccess } from './current-access.decorator';
import { OperationId } from './operation-id.decorator';
import { parseOrgUnitCreate, parseOrgUnitMove, parseOrgUnitUpdate } from './org-unit-dto';

const MANAGE_PERMISSION = PERMISSIONS.createOrganizationUnit;
const RESOURCE_TYPE = 'organization_unit';

/** The caller must hold `iam.unit.manage` on a scope that contains the unit (UNIT_ADMIN: its own subtree only). */
function assertManages(access: EffectiveAccess, unit: UnitView): void {
  const held = effectivePermissions(access, new Date(), { ownerUnitPath: unit.path, ownerUnitId: unit.id });
  if (!holdsPermission(held, MANAGE_PERMISSION)) throw new DomainError('SCOPE_DENIED', 403);
}

/**
 * Organisation unit commands (ST-ADM-004, BR-IAM-09). The policy guard has already checked that the caller holds
 * `iam.unit.manage` somewhere; each handler checks the scope of every unit it touches.
 */
@Controller('org-units')
export class OrgUnitCommandsController {
  @Post()
  @OperationId('createOrganizationUnit')
  @Command({ operation: 'createOrganizationUnit' })
  async create(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Body() body: unknown,
  ): Promise<{ id: string; path: string; depth: number; version: number }> {
    const input = parseOrgUnitCreate(body);
    await lockUnitTree(scope.tx);
    assertManages(access, await loadUnit(scope.tx, input.parentId));
    const created = await createUnit(scope.tx, input);
    await scope.audit({
      action: 'org_unit.create',
      resourceType: RESOURCE_TYPE,
      resourceId: created.id,
      diff: { code: input.code, name: input.name, parent_id: input.parentId, unit_type: input.unitType, valid_from: input.validFrom },
    });
    await scope.emit({
      aggregateType: RESOURCE_TYPE,
      aggregateId: created.id,
      aggregateVersion: created.version,
      type: 'iam.org_unit.created.v1',
      schemaVersion: 1,
      payload: { id: created.id, parent_id: input.parentId, path: created.path },
      eventKey: `${RESOURCE_TYPE}:${created.id}:${created.version}`,
    });
    return created;
  }

  @Put(':unitId')
  @HttpCode(200)
  @OperationId('updateOrganizationUnit')
  @Command({ operation: 'updateOrganizationUnit', versioned: true })
  async update(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() body: unknown,
  ): Promise<{ id: string; version: number }> {
    const patch = parseOrgUnitUpdate(body);
    await lockUnitTree(scope.tx);
    assertManages(access, await loadUnit(scope.tx, unitId));
    const { version } = await updateUnit(scope.tx, unitId, patch, scope.expectedVersion ?? 0);
    await scope.audit({
      action: 'org_unit.update',
      resourceType: RESOURCE_TYPE,
      resourceId: unitId,
      diff: { code: patch.code, name: patch.name, is_investor: patch.isInvestor, administrative_code: patch.administrativeCode, legal_basis_ref: patch.legalBasisRef },
    });
    await scope.emit({
      aggregateType: RESOURCE_TYPE,
      aggregateId: unitId,
      aggregateVersion: version,
      type: 'iam.org_unit.updated.v1',
      schemaVersion: 1,
      payload: { id: unitId },
      eventKey: `${RESOURCE_TYPE}:${unitId}:${version}`,
    });
    return { id: unitId, version };
  }

  @Post(':unitId/move')
  @HttpCode(200)
  @OperationId('moveOrganizationUnit')
  @Command({ operation: 'moveOrganizationUnit', versioned: true })
  async move(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() body: unknown,
  ): Promise<{ id: string; path: string; version: number; moved_units: number }> {
    const input = parseOrgUnitMove(body);
    await lockUnitTree(scope.tx);
    const unit = await loadUnit(scope.tx, unitId);
    assertManages(access, unit);
    assertManages(access, await loadUnit(scope.tx, input.newParentId));

    // Memberships whose reach changes: holders of grants around the old place (found before the rewrite) and around the new one.
    const movedIds = await subtreeUnitIds(scope.tx, unit.path);
    const holdersBefore = await membershipsAffectedByUnits(scope.tx, movedIds);
    const result = await moveUnit(scope.tx, unitId, input.newParentId, scope.expectedVersion);
    const holdersAfter = result.affectedUnitIds.length === 0 ? [] : await membershipsAffectedByUnits(scope.tx, [unitId]);
    const holders = [...new Set([...holdersBefore, ...holdersAfter])].sort();

    await scope.audit({
      action: 'org_unit.move',
      resourceType: RESOURCE_TYPE,
      resourceId: unitId,
      diff: { from_path: result.oldPath, to_path: result.newPath, new_parent_id: input.newParentId, effective_from: input.effectiveFrom, moved_units: result.affectedUnitIds.length },
      reason: input.reason,
    });
    if (result.affectedUnitIds.length > 0) {
      await scope.emit({
        aggregateType: RESOURCE_TYPE,
        aggregateId: unitId,
        aggregateVersion: result.version,
        type: 'iam.org_unit.moved.v1',
        schemaVersion: 1,
        payload: { id: unitId, from_path: result.oldPath, to_path: result.newPath, new_parent_id: input.newParentId },
        eventKey: `${RESOURCE_TYPE}:${unitId}:${result.version}`,
      });
      if (holders.length > 0) {
        await bumpScopeVersion(scope.tx, holders);
        await scope.emit({
          aggregateType: RESOURCE_TYPE,
          aggregateId: unitId,
          aggregateVersion: result.version,
          type: 'iam.access.changed.v1',
          schemaVersion: 1,
          payload: { membership_ids: holders },
          eventKey: `${RESOURCE_TYPE}:${unitId}:${result.version}:access`,
        });
      }
    }
    return { id: unitId, path: result.newPath, version: result.version, moved_units: result.affectedUnitIds.length };
  }
}
