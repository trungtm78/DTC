import { Body, Controller, Get, HttpCode, Inject, Optional, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { LicenseStore, TenantDatabase } from '@machvon/db';
import type { LicenseRow } from '@machvon/db';
import { DomainError, licenseStatusAt } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { Command, Scope } from '../../command.decorator';
import { commandResult } from '../../command-result';
import type { CommandResult } from '../../command-result';
import type { CommandScope } from '../../command-scope';
import type { Schemas } from '../../contract-types';
import { OperationId } from '../../operation-id.decorator';
import { encodeCursor, parsePageRequest } from '../../pagination';
import { CurrentTenant } from '../../tenant-context.decorator';
import { LICENSE_KEYS } from './license-signer';
import type { LicenseKeyStore } from './license-signer';
import { TENANT_STATE_EFFECTS } from './tenant-state-effects';
import type { TenantStateEffects } from './tenant-state-effects';

const RESOURCE_TYPE = 'license';
export const LICENSE_ISSUED_EVENT = 'sas.license.issued.v1';
export const LICENSE_REVOKED_EVENT = 'sas.license.revoked.v1';
/** "Expiring" is a label of the screens, thirty days before valid_until; it changes no right (SAS 3.8). */
const EXPIRING_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * License commands (ST-SAS-003, SAS-12, SAS-15): control plane only, permission `system.license.manage` (a tenant token is
 * 403 whatever its roles, AC43). The server signs with its own entitlement and key: a client cannot send claims (BR-SAS-12).
 * The audit row and the events belong to the tenant of the license and never carry the signed claims or any key.
 */
@Controller('licenses')
export class LicenseController {
  constructor(
    @Inject(LicenseStore) private readonly store: LicenseStore,
    @Inject(LICENSE_KEYS) private readonly keys: LicenseKeyStore,
    @Optional() @Inject(TENANT_STATE_EFFECTS) private readonly effects?: TenantStateEffects,
  ) {}

  @Post()
  @HttpCode(201)
  @OperationId('post_licenses')
  @Command({ operation: 'post_licenses', plane: 'control' })
  async issue(@Scope() scope: CommandScope, @Body() body: Schemas['LicenseIssue']): Promise<CommandResult> {
    const license = await this.store.issue(
      scope.tx,
      {
        tenantId: body.tenant_id,
        edition: body.edition,
        validFrom: new Date(body.valid_from),
        validUntil: new Date(body.valid_until),
        graceUntil: new Date(body.grace_until),
        entitlementVersionId: body.entitlement_version_id,
        seats: body.seats,
        quota: body.quota,
        deploymentBinding: body.deployment_binding,
        offlineLeaseDays: body.offline_lease_days,
        issuedBy: scope.tenant.membershipId,
        restoreTenantId: scope.tenant.tenantId,
      },
      () => this.keys.current(),
      async (issued) => {
        await scope.audit({
          action: 'license.issued',
          resourceType: RESOURCE_TYPE,
          resourceId: issued.id,
          diff: {
            serial: issued.serial,
            revision: issued.revision,
            edition: issued.edition,
            valid_from: issued.validFrom.toISOString(),
            valid_until: issued.validUntil.toISOString(),
            grace_until: issued.graceUntil.toISOString(),
            seats: issued.seats,
            key_id: issued.keyId,
            entitlement_version_id: issued.entitlementVersionId,
          },
        });
        await scope.emit({
          aggregateType: RESOURCE_TYPE,
          aggregateId: issued.id,
          aggregateVersion: issued.version,
          type: LICENSE_ISSUED_EVENT,
          schemaVersion: 1,
          payload: {
            tenant_id: issued.tenantId,
            license_id: issued.id,
            serial: issued.serial,
            revision: issued.revision,
            edition: issued.edition,
            valid_from: issued.validFrom.toISOString(),
            valid_until: issued.validUntil.toISOString(),
            key_id: issued.keyId,
          },
          eventKey: `${RESOURCE_TYPE}:${issued.id}:issued`,
        });
      },
    );
    this.invalidateAfterCommit(scope, license);
    return commandResult(scope, 'ISSUED', license.version, license.id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @OperationId('post_licenses_id_revoke')
  @Command({ operation: 'post_licenses_id_revoke', plane: 'control', versioned: true })
  async revoke(@Scope() scope: CommandScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: Schemas['ReasonOnly']): Promise<CommandResult> {
    const license = await this.store.revoke(
      scope.tx,
      { licenseId: id, reason: body.reason, expectedVersion: scope.expectedVersion ?? 0, restoreTenantId: scope.tenant.tenantId },
      async (revoked) => {
        await scope.audit({
          action: 'license.revoked',
          resourceType: RESOURCE_TYPE,
          resourceId: revoked.id,
          reason: revoked.statusReason ?? body.reason,
          diff: { serial: revoked.serial, revision: revoked.revision, status: revoked.status },
        });
        await scope.emit({
          aggregateType: RESOURCE_TYPE,
          aggregateId: revoked.id,
          aggregateVersion: revoked.version,
          type: LICENSE_REVOKED_EVENT,
          schemaVersion: 1,
          payload: { tenant_id: revoked.tenantId, license_id: revoked.id, serial: revoked.serial, revision: revoked.revision },
          eventKey: `${RESOURCE_TYPE}:${revoked.id}:revoked`,
        });
      },
    );
    this.invalidateAfterCommit(scope, license);
    return commandResult(scope, 'REVOKED', license.version, license.id);
  }

  // A license changes what the tenant may do: the entitlements and the effective access it cached are dropped once the change is committed.
  private invalidateAfterCommit(scope: CommandScope, license: LicenseRow): void {
    const effects = this.effects;
    if (effects !== undefined) scope.afterCommit(() => effects.invalidate(license.tenantId));
  }
}

/** The state of a revision as a person reads it: what the clock says, except for the labels people set (suspended, revoked) or the history (draft, superseded). */
export function effectiveStatus(row: LicenseRow, now: Date): string {
  if (row.status === 'Draft' || row.status === 'Superseded' || row.status === 'Suspended') return row.status;
  return licenseStatusAt({ validFrom: row.validFrom, validUntil: row.validUntil, graceUntil: row.graceUntil, status: row.status }, now);
}

/** openapi.json license_revision item for the tenant plane (`x-exposure: dto`): edition, validity and state; the signed claims and the key stay with the control plane. */
export function licenseView(row: LicenseRow, now: Date): Record<string, unknown> {
  const status = effectiveStatus(row, now);
  return {
    id: row.id,
    serial: row.serial,
    revision: row.revision,
    edition: row.edition,
    status,
    valid_from: row.validFrom.toISOString(),
    valid_until: row.validUntil.toISOString(),
    grace_until: row.graceUntil.toISOString(),
    seats: row.seats,
    issued_at: row.issuedAt?.toISOString() ?? null,
    expiring: status === 'Active' && row.validUntil.getTime() - now.getTime() <= EXPIRING_DAYS * DAY_MS,
    version: row.version,
  };
}

/** The license of the caller's own tenant (get_resources_license_revision and its id form): a tenant never sees another tenant's license. */
@Controller('resources/license_revision')
export class LicenseReadsController {
  constructor(
    @Inject(LicenseStore) private readonly store: LicenseStore,
    @Inject(TenantDatabase) private readonly database: TenantDatabase,
  ) {}

  @Get()
  @OperationId('get_resources_license_revision')
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: Array<Record<string, unknown>>; next_cursor: string | null }> {
    const request = parsePageRequest(limit, cursor);
    const rows = await this.database.withTenant(tenant, (tx) => this.store.list(tx, { limit: request.limit + 1, after: request.after }));
    const shown = rows.slice(0, request.limit);
    const last = shown[shown.length - 1];
    const now = new Date();
    return {
      items: shown.map((row) => licenseView(row, now)),
      next_cursor: rows.length > request.limit && last !== undefined ? encodeCursor({ code: last.serial, id: last.id }) : null,
    };
  }

  @Get(':id')
  @OperationId('get_resources_license_revision_id')
  async get(@CurrentTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Record<string, unknown>> {
    const row = await this.database.withTenant(tenant, (tx) => this.store.find(tx, id));
    if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return licenseView(row, new Date());
  }
}
