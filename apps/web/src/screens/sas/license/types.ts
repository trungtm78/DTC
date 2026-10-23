/** Permission of the license commands (issue, suspend, reinstate, revoke); a reader of the registry sees the licenses without it. */
export const MANAGE_LICENSES_PERMISSION = 'system.license.manage';

/** The states of a license revision as the server reports them (`SystemLicense.status`, SAS 3.8). */
export const LICENSE_STATUSES = ['Draft', 'Scheduled', 'Active', 'Grace', 'Expired', 'Suspended', 'Revoked', 'Superseded'] as const;
export const EDITIONS = ['PILOT', 'STANDARD', 'ENTERPRISE', 'PRIVATE'] as const;
export const SIGNATURE_CHECKS = ['VALID', 'MALFORMED', 'UNKNOWN_KEY', 'BAD_SIGNATURE', 'CLAIMS_MISMATCH'] as const;

export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export type Edition = (typeof EDITIONS)[number];

/** One revision of a license (`SystemLicense` of the contract). */
export interface License {
  id: string;
  tenantId: string;
  serial: string;
  revision: number;
  edition: string;
  status: string;
  validFrom: string;
  validUntil: string;
  graceUntil: string;
  seats: number | undefined;
  statusReason: string | undefined;
  deploymentBinding: string | undefined;
  offlineLeaseUntil: string | undefined;
  keyId: string;
  entitlementVersionId: string;
  supersedesId: string | undefined;
  signatureCheck: string;
  expiring: boolean;
  version: number;
}

export interface LicensePage {
  items: License[];
  nextCursor: string | undefined;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export function toLicense(raw: unknown): License {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    id: text(row.id) ?? '',
    tenantId: text(row.tenant_id) ?? '',
    serial: text(row.serial) ?? '',
    revision: typeof row.revision === 'number' ? row.revision : 0,
    edition: text(row.edition) ?? '',
    status: text(row.status) ?? '',
    validFrom: text(row.valid_from) ?? '',
    validUntil: text(row.valid_until) ?? '',
    graceUntil: text(row.grace_until) ?? '',
    seats: typeof row.seats === 'number' ? row.seats : undefined,
    statusReason: text(row.status_reason),
    deploymentBinding: text(row.deployment_binding),
    offlineLeaseUntil: text(row.offline_lease_until),
    keyId: text(row.key_id) ?? '',
    entitlementVersionId: text(row.entitlement_version_id) ?? '',
    supersedesId: text(row.supersedes_id),
    signatureCheck: text(row.signature_check) ?? '',
    expiring: row.expiring === true,
    version: typeof row.version === 'number' ? row.version : 0,
  };
}

export function toLicensePage(raw: unknown): LicensePage {
  const page = (raw ?? {}) as { items?: unknown[]; next_cursor?: unknown };
  return { items: (page.items ?? []).map(toLicense), nextCursor: text(page.next_cursor) };
}
