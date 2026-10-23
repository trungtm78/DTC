import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { LegalHoldStore, TenantDatabase } from '@machvon/db';
import type { HoldScope, LegalHoldRow } from '@machvon/db';
import { DomainError } from '@machvon/kernel';
import type { EffectiveAccess, TenantContext } from '@machvon/kernel';
import { Command, Scope } from '../../command.decorator';
import { commandResult } from '../../command-result';
import type { CommandResult } from '../../command-result';
import type { CommandScope } from '../../command-scope';
import type { Schemas } from '../../contract-types';
import { CurrentAccess } from '../../current-access.decorator';
import { OperationId } from '../../operation-id.decorator';
import { encodeCursor, parsePageRequest } from '../../pagination';
import { CurrentTenant } from '../../tenant-context.decorator';
import { holdsOnWholeTenant } from './tenant-authority';

const MANAGE_PERMISSION = PERMISSIONS.placeLegalHold;
const READ_PERMISSION = PERMISSIONS.get_resources_legal_hold;
const RESOURCE_TYPE = 'legal_hold';
/** What the authority reference becomes for a caller who may read holds but not manage them (ADM 7: the reference is confidential). */
export const MASKED_AUTHORITY_REFERENCE = '***';
const MAX_SCOPE_IDS = 200;

/** Holds are tenant administration (ADM 2: SECURITY_ADMIN and LEGAL_OFFICER hold the permission on the whole tenant), whatever narrower scope the hold itself has. */
function assertManagesTenant(access: EffectiveAccess): void {
  if (!holdsOnWholeTenant(access, MANAGE_PERMISSION)) throw new DomainError('SCOPE_DENIED', 403);
}

/** The scope of a new hold: a tenant hold lists nothing, every other kind lists one to 200 distinct ids. */
function scopeOf(input: Schemas['LegalHoldCreate']['resource_scope']): HoldScope {
  const ids = [...new Set((input.ids ?? []).map((id) => id.toLowerCase()))];
  const wholeTenant = input.kind === 'TENANT';
  if (wholeTenant ? ids.length > 0 : ids.length === 0 || ids.length > MAX_SCOPE_IDS) throw new DomainError('VALIDATION_FAILED', 422, 'resource_scope.ids');
  return { kind: input.kind, ids };
}

/** openapi.json get_resources_legal_hold item. The authority reference is confidential: only a caller who can manage holds sees it. */
function viewOf(row: LegalHoldRow, mayManage: boolean): Record<string, unknown> {
  return {
    id: row.id,
    hold_kind: row.holdKind,
    status: row.status,
    resource_scope: { kind: row.scope.kind, ids: [...row.scope.ids] },
    authority_reference: mayManage ? row.authorityReference : MASKED_AUTHORITY_REFERENCE,
    reason: row.reason,
    effective_at: row.effectiveAt,
    released_at: row.releasedAt,
    placed_by: row.placedBy,
    released_by: row.releasedBy,
    release_reason: row.releaseReason,
    version: row.version,
  };
}

/**
 * Legal hold commands (ST-ADM-003, BR-PLT-04, BR-ADM-01). A hold does not stop reads or writes of business data: it
 * stops every delete, purge and anonymisation of what it contains (the database trigger and `assertNotOnHold`).
 */
@Controller('legal-holds')
export class LegalHoldsController {
  private readonly store = new LegalHoldStore();

  @Post()
  @OperationId('placeLegalHold')
  @Command({ operation: 'placeLegalHold' })
  async place(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Body() body: Schemas['LegalHoldCreate'],
  ): Promise<CommandResult> {
    assertManagesTenant(access);
    const holdScope = scopeOf(body.resource_scope);
    // Every named id must exist in the tenant: a hold on nothing would protect nothing.
    await this.store.resolveScopeRefs(scope.tx, holdScope);
    const placed = await this.store.place(
      scope.tx,
      { holdKind: body.hold_kind, scope: holdScope, authorityReference: body.authority_reference, reason: body.reason, effectiveAt: body.effective_at },
      scope.tenant.membershipId,
    );
    await scope.audit({
      action: 'legal_hold.place',
      resourceType: RESOURCE_TYPE,
      resourceId: placed.id,
      reason: body.reason,
      classification: 'CONFIDENTIAL',
      diff: { hold_kind: body.hold_kind, resource_scope: { kind: holdScope.kind, ids: holdScope.ids }, effective_at: body.effective_at, authority_reference: body.authority_reference },
      sensitiveKeys: ['authority_reference'],
    });
    await scope.emit({
      aggregateType: RESOURCE_TYPE,
      aggregateId: placed.id,
      aggregateVersion: placed.version,
      type: 'platform.legal_hold.placed.v1',
      schemaVersion: 1,
      payload: { id: placed.id, hold_kind: body.hold_kind, scope_kind: holdScope.kind },
      eventKey: `${RESOURCE_TYPE}:${placed.id}:${placed.version}`,
    });
    return commandResult(scope, 'PLACED', placed.version, placed.id);
  }

  @Post(':holdId/release')
  @HttpCode(200)
  @OperationId('releaseLegalHold')
  @Command({ operation: 'releaseLegalHold', versioned: true })
  async release(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @Body() body: Schemas['ReasonOnly'],
  ): Promise<CommandResult> {
    assertManagesTenant(access);
    const hold = await this.store.lock(scope.tx, holdId, scope.expectedVersion ?? 0);
    const { version } = await this.store.release(scope.tx, hold, scope.tenant.membershipId, body.reason);
    await scope.audit({
      action: 'legal_hold.release',
      resourceType: RESOURCE_TYPE,
      resourceId: holdId,
      reason: body.reason,
      classification: 'CONFIDENTIAL',
      diff: { hold_kind: hold.holdKind, resource_scope: { kind: hold.scope.kind, ids: hold.scope.ids }, placed_by: hold.placedBy },
    });
    await scope.emit({
      aggregateType: RESOURCE_TYPE,
      aggregateId: holdId,
      aggregateVersion: version,
      type: 'platform.legal_hold.released.v1',
      schemaVersion: 1,
      payload: { id: holdId, hold_kind: hold.holdKind, scope_kind: hold.scope.kind },
      eventKey: `${RESOURCE_TYPE}:${holdId}:${version}`,
    });
    return commandResult(scope, 'RELEASED', version, holdId);
  }
}

/** Reads of legal holds (get_resources_legal_hold and its id form): scoped like the commands, the reference masked. */
@Controller('resources/legal_hold')
export class LegalHoldReadsController {
  private readonly store = new LegalHoldStore();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  @Get()
  @OperationId('get_resources_legal_hold')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: Array<Record<string, unknown>>; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    if (!holdsOnWholeTenant(access, READ_PERMISSION)) return { items: [], next_cursor: null };
    const mayManage = holdsOnWholeTenant(access, MANAGE_PERMISSION);
    const rows = await this.database.withTenant(tenant, (tx) => this.store.list(tx, { limit: request.limit + 1, after: request.after === undefined ? undefined : { code: request.after.code, id: request.after.id } }));
    const shown = rows.slice(0, request.limit);
    const last = shown[shown.length - 1];
    return {
      items: shown.map((row) => viewOf(row, mayManage)),
      next_cursor: rows.length > request.limit && last !== undefined ? encodeCursor({ code: last.status, id: last.id }) : null,
    };
  }

  @Get(':id')
  @OperationId('get_resources_legal_hold_id')
  async get(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    // A hold the caller cannot see is indistinguishable from one that does not exist.
    if (!holdsOnWholeTenant(access, READ_PERMISSION)) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    const row = await this.database.withTenant(tenant, (tx) => this.store.find(tx, id));
    if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return viewOf(row, holdsOnWholeTenant(access, MANAGE_PERMISSION));
  }
}
