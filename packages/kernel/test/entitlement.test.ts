import { STANDARD_FEATURES, allowedFeature, entitlementsHash } from '../src/index';
import type { FeatureEntry, LicenseMode, Override } from '../src/index';

const NOW = new Date('2026-10-23T08:00:00Z');
const HOUR = 3_600_000;

type Kind = 'read' | 'write' | 'export';

function check(
  feature: string,
  operationKind: Kind,
  licenseMode: LicenseMode,
  extra: { features?: readonly FeatureEntry[]; overrides?: readonly Override[]; tenantPolicy?: 'FULL' | 'READ_ONLY_EXPORT' | 'NO_ACCESS' } = {},
) {
  return allowedFeature({
    features: extra.features ?? STANDARD_FEATURES,
    overrides: extra.overrides ?? [],
    licenseMode,
    tenantPolicy: extra.tenantPolicy ?? 'FULL',
    feature,
    operationKind,
    now: NOW,
  });
}

const override = (patch: Partial<Override>): Override => ({
  featureCode: 'ai.analysis',
  enabled: true,
  validFrom: new Date(NOW.getTime() - HOUR),
  validUntil: new Date(NOW.getTime() + HOUR),
  status: 'Active',
  ...patch,
});

describe('STANDARD defaults of BR-SAS-10', () => {
  it('lists the five features with their grace and expired behaviours', () => {
    expect(STANDARD_FEATURES.map((entry) => [entry.featureCode, entry.graceBehavior, entry.expiredBehavior])).toEqual([
      ['reporting', 'ALLOW', 'READ_ONLY'],
      ['export', 'ALLOW', 'EXPORT_ONLY'],
      ['ai.analysis', 'DENY', 'DENY'],
      ['notification.campaign', 'DENY', 'DENY'],
      ['member.invite', 'DENY', 'DENY'],
    ]);
  });

  it('allows reporting reads and writes with a full license and in grace', () => {
    expect(check('reporting', 'write', 'FULL')).toEqual({ allowed: true });
    expect(check('reporting', 'write', 'GRACE')).toEqual({ allowed: true });
  });

  it('lets an expired license read reports but not change them or export them', () => {
    expect(check('reporting', 'read', 'EXPIRED')).toEqual({ allowed: true });
    expect(check('reporting', 'write', 'EXPIRED')).toEqual({ allowed: false, reason: 'LICENSE_EXPIRED' });
    expect(check('reporting', 'export', 'EXPIRED')).toEqual({ allowed: false, reason: 'LICENSE_EXPIRED' });
  });

  it('lets an expired license export but not read or write through the export feature', () => {
    expect(check('export', 'export', 'EXPIRED')).toEqual({ allowed: true });
    expect(check('export', 'read', 'EXPIRED')).toEqual({ allowed: false, reason: 'LICENSE_EXPIRED' });
    expect(check('export', 'write', 'EXPIRED')).toEqual({ allowed: false, reason: 'LICENSE_EXPIRED' });
  });

  it.each(['FULL', 'GRACE', 'EXPIRED', 'SUSPENDED', 'REVOKED'] as const)('denies the premium features in %s mode', (mode) => {
    for (const feature of ['ai.analysis', 'notification.campaign', 'member.invite']) {
      for (const kind of ['read', 'write', 'export'] as const) expect(check(feature, kind, mode).allowed).toBe(false);
    }
  });

  it('names FEATURE_OFF when a premium feature is switched off by the plan', () => {
    expect(check('member.invite', 'write', 'FULL')).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
  });

  it('denies a feature the plan does not list', () => {
    expect(check('unknown.feature', 'read', 'FULL')).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
  });
});

describe('grace behaviour', () => {
  const grace = (graceBehavior: FeatureEntry['graceBehavior']): FeatureEntry[] => [
    { featureCode: 'f', limitKind: 'BOOLEAN', graceBehavior, expiredBehavior: 'DENY' },
  ];

  it('READ_ONLY lets reads and exports through and refuses writes, DENY refuses all, ALLOW allows all', () => {
    expect(check('f', 'read', 'GRACE', { features: grace('READ_ONLY') })).toEqual({ allowed: true });
    expect(check('f', 'export', 'GRACE', { features: grace('READ_ONLY') })).toEqual({ allowed: true });
    expect(check('f', 'write', 'GRACE', { features: grace('READ_ONLY') })).toEqual({ allowed: false, reason: 'LICENSE_GRACE' });
    expect(check('f', 'read', 'GRACE', { features: grace('DENY') })).toEqual({ allowed: false, reason: 'LICENSE_GRACE' });
    expect(check('f', 'write', 'GRACE', { features: grace('ALLOW') })).toEqual({ allowed: true });
  });
});

describe('limits switch a feature on or off', () => {
  const feature = (limitKind: FeatureEntry['limitKind'], limitValue?: number): FeatureEntry[] => [
    { featureCode: 'f', limitKind, limitValue, graceBehavior: 'ALLOW', expiredBehavior: 'READ_ONLY' },
  ];

  it('treats a zero limit as off and a missing or positive limit as on', () => {
    expect(check('f', 'write', 'FULL', { features: feature('BOOLEAN', 0) })).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
    expect(check('f', 'write', 'FULL', { features: feature('QUOTA', 0) })).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
    expect(check('f', 'write', 'FULL', { features: feature('METERED', 0) })).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
    expect(check('f', 'write', 'FULL', { features: feature('BOOLEAN') })).toEqual({ allowed: true });
    expect(check('f', 'write', 'FULL', { features: feature('QUOTA', 25) })).toEqual({ allowed: true });
  });
});

describe('overrides', () => {
  it('enable a feature for their window only', () => {
    expect(check('ai.analysis', 'write', 'FULL', { overrides: [override({})] })).toEqual({ allowed: true });
    expect(check('ai.analysis', 'write', 'FULL', { overrides: [override({ validUntil: NOW })] })).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
    expect(check('ai.analysis', 'write', 'FULL', { overrides: [override({ validFrom: NOW })] })).toEqual({ allowed: true });
    expect(check('ai.analysis', 'write', 'FULL', { overrides: [override({ validFrom: new Date(NOW.getTime() + 1) })] })).toEqual({
      allowed: false,
      reason: 'FEATURE_OFF',
    });
  });

  it.each(['PendingApproval', 'Revoked', 'Expired', 'Rejected'])('ignore an override in status %s', (status) => {
    expect(check('ai.analysis', 'write', 'FULL', { overrides: [override({ status })] })).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
  });

  it('can switch a plan feature off', () => {
    expect(check('reporting', 'read', 'FULL', { overrides: [override({ featureCode: 'reporting', enabled: false })] })).toEqual({
      allowed: false,
      reason: 'FEATURE_OFF',
    });
  });

  it('ignore overrides of other features and let the latest active one win', () => {
    expect(check('ai.analysis', 'write', 'FULL', { overrides: [override({ featureCode: 'export' })] }).allowed).toBe(false);
    const earlier = override({ enabled: true, validFrom: new Date(NOW.getTime() - 2 * HOUR) });
    const later = override({ enabled: false, validFrom: new Date(NOW.getTime() - HOUR) });
    expect(check('ai.analysis', 'write', 'FULL', { overrides: [earlier, later] }).allowed).toBe(false);
    expect(check('ai.analysis', 'write', 'FULL', { overrides: [later, earlier] }).allowed).toBe(false);
  });

  it('follow the grace and expired behaviour of the plan entry, and deny when the plan has none', () => {
    expect(check('ai.analysis', 'write', 'GRACE', { overrides: [override({})] })).toEqual({ allowed: false, reason: 'LICENSE_GRACE' });
    expect(check('ai.analysis', 'read', 'EXPIRED', { overrides: [override({})] })).toEqual({ allowed: false, reason: 'LICENSE_EXPIRED' });
    expect(check('extra', 'read', 'GRACE', { overrides: [override({ featureCode: 'extra' })] })).toEqual({ allowed: false, reason: 'LICENSE_GRACE' });
    expect(check('extra', 'read', 'EXPIRED', { overrides: [override({ featureCode: 'extra' })] })).toEqual({ allowed: false, reason: 'LICENSE_EXPIRED' });
    expect(check('extra', 'read', 'FULL', { overrides: [override({ featureCode: 'extra' })] })).toEqual({ allowed: true });
  });
});

describe('suspended and revoked licenses and the tenant policy', () => {
  it.each(['SUSPENDED', 'REVOKED'] as const)('%s denies everything under the full tenant policy', (mode) => {
    for (const kind of ['read', 'write', 'export'] as const) {
      expect(check('reporting', kind, mode)).toEqual({ allowed: false, reason: 'LICENSE_SUSPENDED' });
    }
  });

  it.each(['SUSPENDED', 'REVOKED'] as const)('%s allows reads and exports only under READ_ONLY_EXPORT', (mode) => {
    expect(check('reporting', 'read', mode, { tenantPolicy: 'READ_ONLY_EXPORT' })).toEqual({ allowed: true });
    expect(check('reporting', 'export', mode, { tenantPolicy: 'READ_ONLY_EXPORT' })).toEqual({ allowed: true });
    expect(check('reporting', 'write', mode, { tenantPolicy: 'READ_ONLY_EXPORT' }).allowed).toBe(false);
  });

  it('keeps a feature that is off denied even for reads under READ_ONLY_EXPORT', () => {
    expect(check('ai.analysis', 'read', 'SUSPENDED', { tenantPolicy: 'READ_ONLY_EXPORT' })).toEqual({ allowed: false, reason: 'FEATURE_OFF' });
  });

  it('refuses every write under READ_ONLY_EXPORT even with a full license, and allows reads', () => {
    expect(check('reporting', 'write', 'FULL', { tenantPolicy: 'READ_ONLY_EXPORT' })).toEqual({ allowed: false, reason: 'TENANT_POLICY' });
    expect(check('reporting', 'read', 'FULL', { tenantPolicy: 'READ_ONLY_EXPORT' })).toEqual({ allowed: true });
  });

  it('refuses everything under NO_ACCESS', () => {
    for (const mode of ['FULL', 'GRACE', 'EXPIRED', 'SUSPENDED', 'REVOKED'] as const) {
      for (const kind of ['read', 'write', 'export'] as const) {
        expect(check('reporting', kind, mode, { tenantPolicy: 'NO_ACCESS' })).toEqual({ allowed: false, reason: 'TENANT_POLICY' });
      }
    }
  });
});

describe('entitlementsHash', () => {
  const sample: FeatureEntry[] = [
    { featureCode: 'b', limitKind: 'QUOTA', limitValue: 10, graceBehavior: 'ALLOW', expiredBehavior: 'READ_ONLY' },
    { featureCode: 'a', limitKind: 'BOOLEAN', graceBehavior: 'DENY', expiredBehavior: 'DENY' },
  ];

  it('is a sha256 hex digest that is stable under reordering', () => {
    const hash = entitlementsHash(sample);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entitlementsHash([...sample].reverse())).toBe(hash);
  });

  it('changes with any limit, behaviour or feature', () => {
    const hash = entitlementsHash(sample);
    const first = sample[0] as FeatureEntry;
    expect(entitlementsHash([{ ...first, limitValue: 11 }, sample[1] as FeatureEntry])).not.toBe(hash);
    expect(entitlementsHash([{ ...first, graceBehavior: 'DENY' }, sample[1] as FeatureEntry])).not.toBe(hash);
    expect(entitlementsHash([first])).not.toBe(hash);
    expect(entitlementsHash([])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on how the entries were built', () => {
    const rebuilt = sample.map((entry): FeatureEntry => ({
      expiredBehavior: entry.expiredBehavior,
      graceBehavior: entry.graceBehavior,
      limitValue: entry.limitValue,
      limitKind: entry.limitKind,
      featureCode: entry.featureCode,
    }));
    expect(entitlementsHash(rebuilt)).toBe(entitlementsHash(sample));
  });
});
