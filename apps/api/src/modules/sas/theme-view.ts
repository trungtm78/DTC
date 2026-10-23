import type { ThemeConfig, ThemeVersionRow } from '@machvon/db';
import type { Schemas } from '../../contract-types';

type TenantThemeVersion = Schemas['TenantThemeVersion'];

/** A published theme version as the contract `TenantThemeVersion` names it (shared by the control plane and the tenant read). */
export function versionView(row: ThemeVersionRow): TenantThemeVersion {
  return {
    tenantId: row.tenantId,
    version: row.version,
    config: row.config as ThemeConfig as unknown as Schemas['TenantThemeConfig'],
    hash: row.hash,
    publishedAt: row.publishedAt.toISOString(),
    sourceVersion: row.sourceVersion,
  };
}
