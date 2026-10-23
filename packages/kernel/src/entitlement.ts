import { canonicalJson, sha256Hex } from './canonical-json.ts';

export type LicenseMode = 'FULL' | 'GRACE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';
export type TenantAccessPolicy = 'FULL' | 'READ_ONLY_EXPORT' | 'NO_ACCESS';
export type OperationKind = 'read' | 'write' | 'export';

/** One row of `plan_feature`. */
export interface FeatureEntry {
  featureCode: string;
  limitKind: 'BOOLEAN' | 'QUOTA' | 'METERED';
  limitValue?: number;
  graceBehavior: 'ALLOW' | 'READ_ONLY' | 'DENY';
  expiredBehavior: 'READ_ONLY' | 'EXPORT_ONLY' | 'DENY';
}

/** One row of `entitlement_override`. */
export interface Override {
  featureCode: string;
  enabled: boolean;
  limitValue?: number;
  validFrom: Date;
  validUntil: Date;
  status: string;
}

export type EntitlementDenial = 'FEATURE_OFF' | 'LICENSE_GRACE' | 'LICENSE_EXPIRED' | 'LICENSE_SUSPENDED' | 'TENANT_POLICY';

export interface AllowedFeatureInput {
  features: readonly FeatureEntry[];
  overrides: readonly Override[];
  licenseMode: LicenseMode;
  tenantPolicy: TenantAccessPolicy;
  feature: string;
  operationKind: OperationKind;
  now: Date;
}

/** The STANDARD plan defaults of BR-SAS-10: reporting and export on, the three premium features off. */
export const STANDARD_FEATURES: readonly FeatureEntry[] = [
  { featureCode: 'reporting', limitKind: 'BOOLEAN', graceBehavior: 'ALLOW', expiredBehavior: 'READ_ONLY' },
  { featureCode: 'export', limitKind: 'BOOLEAN', graceBehavior: 'ALLOW', expiredBehavior: 'EXPORT_ONLY' },
  { featureCode: 'ai.analysis', limitKind: 'BOOLEAN', limitValue: 0, graceBehavior: 'DENY', expiredBehavior: 'DENY' },
  { featureCode: 'notification.campaign', limitKind: 'BOOLEAN', limitValue: 0, graceBehavior: 'DENY', expiredBehavior: 'DENY' },
  { featureCode: 'member.invite', limitKind: 'BOOLEAN', limitValue: 0, graceBehavior: 'DENY', expiredBehavior: 'DENY' },
];

// A limit of zero switches the feature off whatever its kind; no limit, or a positive one, leaves it on. Quotas and
// meters are enforced elsewhere (BR-SAS-09) against `usage_counter`; this function only decides on or off.
const planOn = (entry: FeatureEntry | undefined): boolean => entry !== undefined && (entry.limitValue === undefined || entry.limitValue > 0);

/** The override in force for the feature at `now`: when several are, the one that started last wins (BR-SAS-10). */
export function activeOverride(overrides: readonly Override[], feature: string, now: Date): Override | undefined {
  const at = now.getTime();
  return overrides
    .filter((o) => o.featureCode === feature && o.status === 'Active' && o.validFrom.getTime() <= at && at < o.validUntil.getTime())
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
}

const ok = { allowed: true } as const;
const no = (reason: EntitlementDenial): { allowed: false; reason: EntitlementDenial } => ({ allowed: false, reason });

/**
 * `allowed(feature) = plan + active override` (BR-SAS-10), judged for one kind of operation.
 *
 * Order: the tenant policy (NO_ACCESS refuses everything, READ_ONLY_EXPORT refuses writes), then whether the feature
 * is on (the latest active override wins over the plan row), then the license mode: FULL allows; GRACE and EXPIRED
 * follow the behaviour of the plan row (DENY when the plan has no row for an override-enabled feature, the safe
 * choice); SUSPENDED and REVOKED deny everything except reads and exports under READ_ONLY_EXPORT.
 */
export function allowedFeature(input: AllowedFeatureInput): { allowed: boolean; reason?: EntitlementDenial } {
  const { tenantPolicy, operationKind, licenseMode } = input;
  if (tenantPolicy === 'NO_ACCESS') return no('TENANT_POLICY');
  if (tenantPolicy === 'READ_ONLY_EXPORT' && operationKind === 'write') return no('TENANT_POLICY');

  const entry = input.features.find((candidate) => candidate.featureCode === input.feature);
  const override = activeOverride(input.overrides, input.feature, input.now);
  if (!(override === undefined ? planOn(entry) : override.enabled)) return no('FEATURE_OFF');

  switch (licenseMode) {
    case 'FULL':
      return ok;
    case 'GRACE': {
      const behaviour = entry?.graceBehavior ?? 'DENY';
      if (behaviour === 'ALLOW') return ok;
      return behaviour === 'READ_ONLY' && operationKind !== 'write' ? ok : no('LICENSE_GRACE');
    }
    case 'EXPIRED': {
      const behaviour = entry?.expiredBehavior ?? 'DENY';
      const permitted = behaviour === 'READ_ONLY' ? operationKind === 'read' : behaviour === 'EXPORT_ONLY' && operationKind === 'export';
      return permitted ? ok : no('LICENSE_EXPIRED');
    }
    case 'SUSPENDED':
    case 'REVOKED':
      return tenantPolicy === 'READ_ONLY_EXPORT' && operationKind !== 'write' ? ok : no('LICENSE_SUSPENDED');
  }
}

/** `entitlement_version.entitlements_hash`: sha256 of the canonical JSON of the features sorted by code. */
export function entitlementsHash(features: readonly FeatureEntry[]): string {
  const sorted = [...features].sort((a, b) => (a.featureCode < b.featureCode ? -1 : a.featureCode > b.featureCode ? 1 : 0));
  return sha256Hex(canonicalJson(sorted));
}
