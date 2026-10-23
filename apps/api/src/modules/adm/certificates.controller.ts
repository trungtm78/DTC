import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@machvon/contracts';
import { CertificateStore, TenantDatabase } from '@machvon/db';
import type { CertificateRow } from '@machvon/db';
import { DomainError, parseSigningCertificate } from '@machvon/kernel';
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

const MANAGE_PERMISSION = PERMISSIONS.registerSigningCertificate;
const READ_PERMISSION = PERMISSIONS.get_resources_signing_certificate;
const RESOURCE_TYPE = 'signing_certificate';

/** The registry is tenant administration (ADM 3.9): only a grant on the whole tenant manages it. */
function assertManages(access: EffectiveAccess): void {
  if (!holdsOnWholeTenant(access, MANAGE_PERMISSION)) throw new DomainError('SCOPE_DENIED', 403);
}

/** openapi.json get_resources_signing_certificate item: public facts only, there is no key material to show. */
function viewOf(row: CertificateRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    holder_membership_id: row.holderMembershipId,
    organization_unit_id: row.organizationUnitId,
    certificate_serial: row.serial,
    issuer_dn: row.issuerDn,
    subject_dn: row.subjectDn,
    provider_code: row.providerCode,
    valid_from: row.validFrom,
    valid_until: row.validUntil,
    fingerprint_sha256: row.fingerprintSha256,
    status: row.status,
    status_reason: row.statusReason,
    registered_by: row.registeredBy,
    version: row.version,
  };
}

/**
 * Signing certificate commands (ST-ADM-008, ADM 3.9). The registry holds public certificates only: the request is
 * parsed here, a private key in the text is refused, and only the public facts are stored, audited and published.
 */
@Controller('signing-certificates')
export class SigningCertificatesController {
  private readonly store = new CertificateStore();

  @Post()
  @OperationId('registerSigningCertificate')
  @Command({ operation: 'registerSigningCertificate' })
  async register(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Body() body: Schemas['SigningCertificateRegister'],
  ): Promise<CommandResult> {
    assertManages(access);
    const parsed = parseSigningCertificate(body.certificate_pem, new Date());
    const registered = await this.store.register(
      scope.tx,
      { kind: body.kind, holderMembershipId: body.holder_membership_id, organizationUnitId: body.organization_unit_id, providerCode: body.provider_code, parsed },
      scope.tenant.membershipId,
    );
    await scope.audit({
      action: 'signing_certificate.register',
      resourceType: RESOURCE_TYPE,
      resourceId: registered.id,
      classification: 'CONFIDENTIAL',
      diff: { kind: body.kind, certificate_serial: parsed.serial, fingerprint_sha256: parsed.fingerprintSha256, provider_code: body.provider_code, valid_until: parsed.validUntil.toISOString() },
    });
    await scope.emit({
      aggregateType: RESOURCE_TYPE,
      aggregateId: registered.id,
      aggregateVersion: registered.version,
      type: 'adm.signing_certificate.registered.v1',
      schemaVersion: 1,
      payload: { id: registered.id, kind: body.kind, valid_until: parsed.validUntil.toISOString() },
      eventKey: `${RESOURCE_TYPE}:${registered.id}:${registered.version}`,
    });
    return commandResult(scope, 'REGISTERED', registered.version, registered.id);
  }

  @Post(':certificateId/revoke')
  @HttpCode(200)
  @OperationId('revokeSigningCertificate')
  @Command({ operation: 'revokeSigningCertificate', versioned: true })
  async revoke(
    @Scope() scope: CommandScope,
    @CurrentAccess() access: EffectiveAccess,
    @Param('certificateId', ParseUUIDPipe) certificateId: string,
    @Body() body: Schemas['ReasonOnly'],
  ): Promise<CommandResult> {
    assertManages(access);
    const certificate = await this.store.lock(scope.tx, certificateId, scope.expectedVersion ?? 0);
    const { version } = await this.store.revoke(scope.tx, certificate, body.reason);
    await scope.audit({
      action: 'signing_certificate.revoke',
      resourceType: RESOURCE_TYPE,
      resourceId: certificateId,
      reason: body.reason,
      classification: 'CONFIDENTIAL',
      diff: { kind: certificate.kind, certificate_serial: certificate.serial, fingerprint_sha256: certificate.fingerprintSha256 },
    });
    await scope.emit({
      aggregateType: RESOURCE_TYPE,
      aggregateId: certificateId,
      aggregateVersion: version,
      type: 'adm.signing_certificate.revoked.v1',
      schemaVersion: 1,
      payload: { id: certificateId, kind: certificate.kind },
      eventKey: `${RESOURCE_TYPE}:${certificateId}:${version}`,
    });
    return commandResult(scope, 'REVOKED', version, certificateId);
  }
}

/** Reads of the registry (get_resources_signing_certificate and its id form; CR-ADM-06): tenant-wide, the soonest end of validity first. */
@Controller('resources/signing_certificate')
export class SigningCertificateReadsController {
  private readonly store = new CertificateStore();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  @Get()
  @OperationId('get_resources_signing_certificate')
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
      next_cursor: rows.length > request.limit && last !== undefined ? encodeCursor({ code: last.validUntil, id: last.id }) : null,
    };
  }

  @Get(':id')
  @OperationId('get_resources_signing_certificate_id')
  async get(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: EffectiveAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    // A certificate the caller cannot see is indistinguishable from one that does not exist.
    if (!holdsOnWholeTenant(access, READ_PERMISSION)) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    const row = await this.database.withTenant(tenant, (tx) => this.store.find(tx, id));
    if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return viewOf(row);
  }
}
