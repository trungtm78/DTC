import { allowedFeature } from '@machvon/kernel';
import type { FeatureEntry, OperationKind, Override } from '@machvon/kernel';
import type { EntitlementSnapshot } from '@machvon/db';

/** `EntitlementView` of openapi.json. */
export interface EntitlementView {
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

function activeOverrideOn(overrides: readonly Override[], feature: string, now: Date): Override | undefined {
  const at = now.getTime();
  return overrides.find((o) => o.featureCode === feature && o.status === 'Active' && o.validFrom.getTime() <= at && at < o.validUntil.getTime());
}

function viewOf(snapshot: EntitlementSnapshot, entry: FeatureEntry, now: Date): FeatureView {
  const judge = (kind: OperationKind): boolean =>
    allowedFeature({
      features: snapshot.features,
      overrides: snapshot.overrides,
      licenseMode: snapshot.licenseMode,
      tenantPolicy: snapshot.tenantPolicy,
      feature: entry.featureCode,
      operationKind: kind,
      now,
    }).allowed;
  const [write, read, exported] = [judge('write'), judge('read'), judge('export')];
  const override = activeOverrideOn(snapshot.overrides, entry.featureCode, now);
  const limit = override?.limitValue ?? entry.limitValue;
  return {
    feature_code: entry.featureCode,
    allowed: write || read || exported,
    ...(limit === undefined ? {} : { limit: String(limit) }),
    source: override === undefined ? 'PLAN' : 'OVERRIDE',
    mode: write ? 'FULL' : read ? 'READ_ONLY' : exported ? 'EXPORT_ONLY' : 'DENIED',
  };
}

/** What a tenant may do with each feature of its plan right now: the mode is the widest kind of operation allowed. */
export function entitlementView(snapshot: EntitlementSnapshot, now: Date): EntitlementView {
  const features = [...snapshot.features].sort((a, b) => (a.featureCode < b.featureCode ? -1 : a.featureCode > b.featureCode ? 1 : 0));
  return {
    version_no: snapshot.versionNo,
    entitlements_hash: snapshot.hash,
    license_status: snapshot.licenseMode,
    features: features.map((entry) => viewOf(snapshot, entry, now)),
  };
}
