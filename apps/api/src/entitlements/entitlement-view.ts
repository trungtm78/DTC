import { activeOverride, allowedFeature } from '@machvon/kernel';
import type { FeatureEntry, OperationKind } from '@machvon/kernel';
import type { EntitlementSnapshot } from '@machvon/db';

/** `EntitlementView` of openapi.json. */
export interface EntitlementView {
  /** Id of the current version; only the control plane read carries it (the license form signs this version). */
  version_id?: string;
  version_no: number;
  entitlements_hash: string;
  license_status: string;
  features: FeatureView[];
}

export interface FeatureView {
  feature_code: string;
  allowed: boolean;
  limit?: string;
  source: 'PLAN' | 'OVERRIDE';
  mode: 'FULL' | 'READ_ONLY' | 'EXPORT_ONLY' | 'DENIED';
}

// `entry` is the plan row; a feature that only an override switches on has none.
function viewOf(snapshot: EntitlementSnapshot, featureCode: string, entry: FeatureEntry | undefined, now: Date): FeatureView {
  const judge = (kind: OperationKind): boolean =>
    allowedFeature({
      features: snapshot.features,
      overrides: snapshot.overrides,
      licenseMode: snapshot.licenseMode,
      tenantPolicy: snapshot.tenantPolicy,
      feature: featureCode,
      operationKind: kind,
      now,
    }).allowed;
  const [write, read, exported] = [judge('write'), judge('read'), judge('export')];
  // The kernel's own rule picks the override, so the view and the gate can never disagree about which one is in force.
  const override = activeOverride(snapshot.overrides, featureCode, now);
  const limit = override?.limitValue ?? entry?.limitValue;
  return {
    feature_code: featureCode,
    allowed: write || read || exported,
    ...(limit === undefined ? {} : { limit: String(limit) }),
    source: override === undefined ? 'PLAN' : 'OVERRIDE',
    mode: write ? 'FULL' : read ? 'READ_ONLY' : exported ? 'EXPORT_ONLY' : 'DENIED',
  };
}

/**
 * What a tenant may do with each feature right now: every feature of the plan, plus every feature an override that is in
 * force switches on (the gate lets those through, so the view must show them). The mode is the widest kind of operation allowed.
 */
export function entitlementView(snapshot: EntitlementSnapshot, now: Date): EntitlementView {
  const planned = new Map(snapshot.features.map((entry) => [entry.featureCode, entry]));
  const codes = new Set(planned.keys());
  for (const candidate of snapshot.overrides) {
    if (activeOverride(snapshot.overrides, candidate.featureCode, now) !== undefined) codes.add(candidate.featureCode);
  }
  const sorted = [...codes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    version_no: snapshot.versionNo,
    entitlements_hash: snapshot.hash,
    license_status: snapshot.licenseMode,
    features: sorted.map((code) => viewOf(snapshot, code, planned.get(code), now)),
  };
}
