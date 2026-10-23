import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ControlDatabase, PLATFORM_TENANT_ID, TenantDatabase, ThemeStore, themeChanges, themeHash } from '@machvon/db';
import type { TenantTx, ThemeAssetRow, ThemeConfig, ThemeVersionRow } from '@machvon/db';
import { DomainError, formatEtag } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import { Command, Scope } from '../../command.decorator';
import type { CommandScope } from '../../command-scope';
import type { Schemas } from '../../contract-types';
import { OperationId } from '../../operation-id.decorator';
import { encodeCursor, parsePageRequest } from '../../pagination';
import { CurrentTenant } from '../../tenant-context.decorator';
import { FileService } from '../files';
import { MAX_THEME_ASSET_BYTES, SingleFileUploadGuard, UploadedBytes } from './theme-assets';
import type { UploadedFile } from './theme-assets';
import { assertValidTheme } from './theme-validation';

const RESOURCE_TYPE = 'tenant_theme';
export const THEME_PUBLISHED_EVENT = 'sas.theme.published.v1';
const SCAN_STATUS_OF = { PENDING: 'pending', CLEAN: 'clean', INFECTED: 'rejected' } as const;

type TenantThemeConfig = Schemas['TenantThemeConfig'];
type TenantThemeVersion = Schemas['TenantThemeVersion'];

const configOf = (config: ThemeConfig): TenantThemeConfig => config as unknown as TenantThemeConfig;

function versionView(row: ThemeVersionRow): TenantThemeVersion {
  return { tenantId: row.tenantId, version: row.version, config: configOf(row.config), hash: row.hash, publishedAt: row.publishedAt.toISOString(), sourceVersion: row.sourceVersion };
}

/**
 * The theme of a tenant (ST-SAS-005, SAS 3.12, BR-SAS-17): only a System Admin writes it, on the control plane, and the
 * tenant reads the published version only. The commands run in the control transaction under the platform tenant and
 * act as the tenant of the theme while they store, audit and emit, so every row belongs to that tenant. A theme is never
 * published unreviewed: the review binds the person, the tenant, the content and the base version (15 minutes, once).
 */
@Controller()
export class ThemeController {
  constructor(
    @Inject(ThemeStore) private readonly store: ThemeStore,
    @Inject(ControlDatabase) private readonly control: ControlDatabase,
    @Inject(TenantDatabase) private readonly tenants: TenantDatabase,
    @Inject(FileService) private readonly files: FileService,
  ) {}

  /** getMyPublishedTheme: the published version of the caller's own tenant, for any member (`tenant.theme.read`). */
  @Get('me/tenant/theme')
  @OperationId('getMyPublishedTheme')
  async mine(@CurrentTenant() tenant: TenantContext): Promise<TenantThemeVersion> {
    const published = await this.tenants.withTenant(tenant, (tx) => this.store.currentVersion(tx, tenant.tenantId));
    if (published === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return versionView(published);
  }

  @Get('system/tenants/:tenantId/theme/draft')
  @OperationId('getSystemTenantThemeDraft')
  async draft(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }): Promise<Schemas['TenantThemeDraft']> {
    const draft = await this.reading(tenantId, (tx) => this.store.getDraft(tx, tenantId));
    response.setHeader('ETag', formatEtag(draft.revision));
    return { revision: draft.revision, config: configOf(draft.config) };
  }

  @Put('system/tenants/:tenantId/theme/draft')
  @HttpCode(200)
  @OperationId('putSystemTenantThemeDraft')
  @Command({ operation: 'putSystemTenantThemeDraft', plane: 'control', versioned: true })
  async putDraft(
    @Scope() scope: CommandScope,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: TenantThemeConfig,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown },
  ): Promise<Schemas['TenantThemeDraft']> {
    assertValidTheme(body);
    const config = body as unknown as ThemeConfig;
    const saved = await this.store.actingAs(scope.tx, tenantId, scope.tenant.tenantId, async () => {
      await this.assertLogoUsable(scope.tx, tenantId, body.logoAssetId);
      const before = await this.store.getDraft(scope.tx, tenantId);
      const draft = await this.store.saveDraft(scope.tx, { tenantId, config, expectedRevision: scope.expectedVersion ?? 0, actorId: scope.tenant.membershipId });
      await scope.audit({
        action: 'tenant.theme_draft.saved',
        resourceType: RESOURCE_TYPE,
        resourceId: tenantId,
        diff: { revision: draft.revision, config_hash: themeHash(config), changed_fields: themeChanges(before.config, config).map((change) => change.field) },
      });
      return draft;
    });
    response.setHeader('ETag', formatEtag(saved.revision));
    return { revision: saved.revision, config: configOf(saved.config) };
  }

  @Get('system/tenants/:tenantId/theme/versions')
  @OperationId('listSystemTenantThemeVersions')
  async versions(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('limit') limit?: unknown,
    @Query('cursor') cursor?: unknown,
  ): Promise<{ items: TenantThemeVersion[]; nextCursor: string | null }> {
    const page = parsePageRequest(limit, cursor);
    // The cursor names the last version of the page before and the tenant it was issued for (a cursor of another tenant is refused).
    if (page.after !== undefined && page.after.id !== tenantId) throw new DomainError('VALIDATION_FAILED', 422, 'cursor');
    const after = page.after === undefined ? undefined : { version: Number(page.after.code) };
    if (after !== undefined && !Number.isSafeInteger(after.version)) throw new DomainError('VALIDATION_FAILED', 422, 'cursor');
    const rows = await this.reading(tenantId, (tx) => this.store.listVersions(tx, tenantId, { limit: page.limit + 1, after }));
    const items = rows.slice(0, page.limit);
    const last = items[items.length - 1];
    return { items: items.map(versionView), nextCursor: rows.length > page.limit && last !== undefined ? encodeCursor({ code: String(last.version), id: tenantId }) : null };
  }

  /** reviewSystemTenantTheme: the draft (`draftRevision`) or a version to restore (`sourceVersion` and a reason); the answer carries the only copy of the token. */
  @Post('system/tenants/:tenantId/theme/reviews')
  @HttpCode(200)
  @OperationId('reviewSystemTenantTheme')
  @Command({ operation: 'reviewSystemTenantTheme', plane: 'control' })
  async review(@Scope() scope: CommandScope, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() body: Schemas['TenantThemeReviewRequest']): Promise<Schemas['TenantThemeReview']> {
    const restoring = 'sourceVersion' in body;
    return this.store.actingAs(scope.tx, tenantId, scope.tenant.tenantId, async () => {
      const reviewed = await this.store.createReview(scope.tx, {
        tenantId,
        actorId: scope.tenant.membershipId,
        baseVersion: body.baseVersion,
        draftRevision: restoring ? undefined : body.draftRevision,
        sourceVersion: restoring ? body.sourceVersion : undefined,
        reason: restoring ? body.reason : undefined,
        now: new Date(),
      });
      assertValidTheme(configOf(reviewed.candidate));
      await this.assertLogoUsable(scope.tx, tenantId, reviewed.candidate.logoAssetId);
      await scope.audit({
        action: 'tenant.theme.reviewed',
        resourceType: RESOURCE_TYPE,
        resourceId: tenantId,
        ...(restoring ? { reason: body.reason } : {}),
        diff: {
          base_version: reviewed.baseVersion,
          candidate_hash: themeHash(reviewed.candidate),
          ...(restoring ? { source_version: body.sourceVersion } : { draft_revision: body.draftRevision }),
          changed_fields: reviewed.changes.map((change) => change.field),
        },
      });
      return { reviewToken: reviewed.token, expiresAt: reviewed.expiresAt.toISOString(), baseVersion: reviewed.baseVersion, candidate: configOf(reviewed.candidate), changes: reviewed.changes };
    });
  }

  /** publishSystemTenantTheme: consumes the review and appends the next version in one transaction (also how a rollback is published). */
  @Post('system/tenants/:tenantId/theme/publish')
  @HttpCode(200)
  @OperationId('publishSystemTenantTheme')
  @Command({ operation: 'publishSystemTenantTheme', plane: 'control' })
  async publish(@Scope() scope: CommandScope, @Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() body: Schemas['TenantThemePublish']): Promise<TenantThemeVersion> {
    return this.store.actingAs(scope.tx, tenantId, scope.tenant.tenantId, async () => {
      const before = await this.store.currentVersion(scope.tx, tenantId);
      const published = await this.store.publish(scope.tx, { tenantId, actorId: scope.tenant.membershipId, token: body.reviewToken, baseVersion: body.baseVersion, now: new Date() });
      await scope.audit({
        action: 'tenant.theme.published',
        resourceType: RESOURCE_TYPE,
        resourceId: tenantId,
        ...(published.reason === null ? {} : { reason: published.reason }),
        diff: {
          version: published.version,
          base_version: body.baseVersion,
          config_hash: published.hash,
          source_version: published.sourceVersion,
          changed_fields: themeChanges(before?.config ?? {}, published.config).map((change) => change.field),
        },
      });
      await scope.emit({
        aggregateType: RESOURCE_TYPE,
        aggregateId: tenantId,
        aggregateVersion: published.version,
        type: THEME_PUBLISHED_EVENT,
        schemaVersion: 1,
        payload: { tenant_id: tenantId, version: published.version, config_hash: published.hash, source_version: published.sourceVersion },
        eventKey: `${RESOURCE_TYPE}:${tenantId}:published:${published.version}`,
      });
      return versionView(published);
    });
  }

  /**
   * uploadSystemTenantThemeAsset: one logo (PNG, JPEG or WebP, at most 1 MiB), judged by its bytes, stored privately under the
   * tenant prefix and scanned; an SVG is never accepted. It is usable in a draft once the scan has found it clean.
   */
  @Post('system/tenants/:tenantId/theme/assets')
  @HttpCode(200)
  @UseGuards(SingleFileUploadGuard)
  @OperationId('uploadSystemTenantThemeAsset')
  @Command({ operation: 'uploadSystemTenantThemeAsset', plane: 'control' })
  async upload(@Scope() scope: CommandScope, @Param('tenantId', ParseUUIDPipe) tenantId: string, @UploadedBytes() file: UploadedFile): Promise<Schemas['TenantThemeAsset']> {
    return this.store.actingAs(scope.tx, tenantId, scope.tenant.tenantId, async () => {
      if (file.bytes.length > MAX_THEME_ASSET_BYTES) throw new DomainError('PAYLOAD_TOO_LARGE', 413);
      const stored = await this.files.upload({ tenantId, membershipId: scope.tenant.membershipId, scopeVersion: 0 }, { purpose: 'logo', declaredType: file.contentType, bytes: file.bytes });
      if (stored.scanStatus === 'INFECTED') throw new DomainError('FILE_NOT_CLEAN', 422);
      const asset = await this.store.registerAsset(scope.tx, {
        tenantId,
        id: randomUUID(),
        contentHash: file.sha256,
        mime: file.contentType,
        sizeBytes: file.bytes.length,
        storageKey: stored.key,
        scanStatus: SCAN_STATUS_OF[stored.scanStatus],
        createdBy: scope.tenant.membershipId,
      });
      await scope.audit({
        action: 'tenant.theme_asset.uploaded',
        resourceType: RESOURCE_TYPE,
        resourceId: tenantId,
        diff: { asset_id: asset.id, content_hash: asset.contentHash, content_type: asset.mime, size_bytes: asset.sizeBytes, scan_status: asset.scanStatus },
      });
      return assetView(asset);
    });
  }

  // A read of the control plane: the control transaction under the platform tenant, acting as the tenant of the theme.
  private reading<T>(tenantId: string, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.control.withTenantOf(PLATFORM_TENANT_ID, (tx) => this.store.actingAs(tx, tenantId, PLATFORM_TENANT_ID, () => work(tx)));
  }

  // The logo of a theme is an asset of this tenant whose scan found it clean: nothing else, never a URL.
  private async assertLogoUsable(tx: TenantTx, tenantId: string, logoAssetId: string | null | undefined): Promise<void> {
    if (logoAssetId === null || logoAssetId === undefined) return;
    const asset = await this.store.findAsset(tx, tenantId, logoAssetId);
    if (asset?.scanStatus !== 'clean') throw new DomainError('VALIDATION_FAILED', 422, 'logoAssetId');
  }
}

function assetView(asset: ThemeAssetRow): Schemas['TenantThemeAsset'] {
  return { assetId: asset.id, scanStatus: asset.scanStatus, contentHash: asset.contentHash, contentType: asset.mime as Schemas['TenantThemeAsset']['contentType'] };
}
