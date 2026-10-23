import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { SecurityPolicyStore, TenantDatabase } from '@machvon/db';
import type { SecurityPolicyRow } from '@machvon/db';
import { DomainError, validateSecurityPolicy } from '@machvon/kernel';
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

const DRAFT_PERMISSION = PERMISSIONS.createSecurityPolicyVersion;
const APPROVE_PERMISSION = PERMISSIONS.publishSecurityPolicy;
const READ_PERMISSION = PERMISSIONS.get_resources_security_policy_version;
const RESOURCE_TYPE = 'security_policy_version';

/** The security policy is tenant administration (ADM 3.10): only a grant on the whole tenant reaches it. */
function assertHolds(access: EffectiveAccess, permission: string): void {
  if (!holdsOnWholeTenant(access, permission)) throw new DomainError('SCOPE_DENIED', 403);
}

/** openapi.json get_resources_security_policy_version item. */
function viewOf(row: SecurityPolicyRow): Record<string, unknown> {
  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    mfa_required_roles: [...row.content.mfa_required_roles],
    session_idle_minutes: row.content.session_idle_minutes,
    session_max_hours: row.content.session_max_hours,
    ip_allowlist: [...(row.content.ip_allowlist ?? [])],
    download_ttl_minutes: row.content.download_ttl_minutes ?? null,
    export_watermark: row.content.export_watermark ?? false,
    created_by: row.createdBy,
    approved_by: row.approvedBy,
    published_at: row.publishedAt,
    version: row.version,
  };
}

/**
 * Security policy version commands (ST-ADM-009, ADM 3.10). A draft changes nothing; publishing needs a second person
 * and makes the version the one in force (the next sign-in and tenant selection read it).
 */
@Controller('security-policies')
export class SecurityPoliciesController {
  private readonly store = new SecurityPolicyStore();

  @Post()
  @OperationId('createSecurityPolicyVersion')
  @Command({ operation: 'createSecurityPolicyVersion' })
  async create(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Body() body: Schemas['SecurityPolicyDraft'],
  ): Promise<CommandResult> {
    assertHolds(access, DRAFT_PERMISSION);
    validateSecurityPolicy(body, await this.store.roleCodes(scope.tx));
    const created = await this.store.createDraft(scope.tx, body, scope.tenant.membershipId);
    await scope.audit({
      action: 'security_policy.create',
      resourceType: RESOURCE_TYPE,
      resourceId: created.id,
      classification: 'CONFIDENTIAL',
      diff: {
        revision: created.revision,
        mfa_required_roles: body.mfa_required_roles,
        session_idle_minutes: body.session_idle_minutes,
        session_max_hours: body.session_max_hours,
        ip_allowlist_entries: body.ip_allowlist?.length ?? 0,
      },
    });
    return commandResult(scope, 'DRAFTED', created.version, created.id);
  }

  @Post(':policyId/publish')
  @HttpCode(200)
  @OperationId('publishSecurityPolicy')
  @Command({ operation: 'publishSecurityPolicy', versioned: true })
  async publish(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body() body: Schemas['ReasonOnly'],
  ): Promise<CommandResult> {
    assertHolds(access, APPROVE_PERMISSION);
    const draft = await this.store.lockDraft(scope.tx, policyId, scope.expectedVersion ?? 0);
    // Roles may have been removed since the draft was written: the policy is checked again when it takes effect.
    validateSecurityPolicy(draft.content, await this.store.roleCodes(scope.tx));
    const { version, supersededId } = await this.store.publish(scope.tx, draft, scope.tenant.membershipId);
    await scope.audit({
      action: 'security_policy.publish',
      resourceType: RESOURCE_TYPE,
      resourceId: policyId,
      reason: body.reason,
      classification: 'CONFIDENTIAL',
      diff: { revision: draft.revision, author: draft.createdBy, superseded_id: supersededId ?? null },
    });
    await scope.emit({
      aggregateType: RESOURCE_TYPE,
      aggregateId: policyId,
      aggregateVersion: version,
      type: 'adm.security_policy.published.v1',
      schemaVersion: 1,
      payload: { id: policyId, revision: draft.revision },
      eventKey: `${RESOURCE_TYPE}:${policyId}:${version}`,
    });
    return commandResult(scope, 'PUBLISHED', version, policyId);
  }
}

/** Reads of the policy versions (get_resources_security_policy_version and its id form; CR-ADM-06): newest revision first. */
@Controller('resources/security_policy_version')
export class SecurityPolicyReadsController {
  private readonly store = new SecurityPolicyStore();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  @Get()
  @OperationId('get_resources_security_policy_version')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: Array<Record<string, unknown>>; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    if (!holdsOnWholeTenant(access, READ_PERMISSION)) return { items: [], next_cursor: null };
    const rows = await this.database.withTenant(tenant, (tx) =>
      this.store.list(tx, { limit: request.limit + 1, after: request.after === undefined ? undefined : { code: request.after.code, id: request.after.id } }),
    );
    const shown = rows.slice(0, request.limit);
    const last = shown[shown.length - 1];
    return {
      items: shown.map(viewOf),
      next_cursor: rows.length > request.limit && last !== undefined ? encodeCursor({ code: String(last.revision), id: last.id }) : null,
    };
  }

  @Get(':id')
  @OperationId('get_resources_security_policy_version_id')
  async get(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    if (!holdsOnWholeTenant(access, READ_PERMISSION)) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    const row = await this.database.withTenant(tenant, (tx) => this.store.find(tx, id));
    if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return viewOf(row);
  }
}
