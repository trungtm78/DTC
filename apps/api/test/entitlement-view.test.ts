import { STANDARD_FEATURES } from '@machvon/kernel';
import type { FeatureEntry, Override } from '@machvon/kernel';
import type { EntitlementSnapshot } from '@machvon/db';
import { entitlementView } from '../src/entitlements/entitlement-view';

const NOW = new Date('2026-10-23T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number): Date => new Date(NOW.getTime() + days * DAY);

function snapshot(overrides: Override[], overrides2: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return {
    versionNo: 3,
    hash: 'a'.repeat(64),
    features: [...STANDARD_FEATURES],
    overrides,
    licenseMode: 'FULL',
    tenantPolicy: 'FULL',
    ...overrides2,
  };
}

const override = (featureCode: string, enabled: boolean, validFrom: number, validUntil: number, limitValue?: number): Override => ({
  featureCode,
  enabled,
  ...(limitValue === undefined ? {} : { limitValue }),
  validFrom: at(validFrom),
  validUntil: at(validUntil),
  status: 'Active',
});

const byCode = (view: ReturnType<typeof entitlementView>, code: string) => view.features.find((feature) => feature.feature_code === code);

describe('entitlementView', () => {
  it('lists a feature that only an override switches on, because the gate lets it through', () => {
    const view = entitlementView(snapshot([override('ai.premium', true, -1, 30, 5)]), NOW);
    expect(byCode(view, 'ai.premium')).toEqual({ feature_code: 'ai.premium', allowed: true, limit: '5', source: 'OVERRIDE', mode: 'FULL' });
  });

  it('does not list an override-only feature whose override is not in force now', () => {
    const view = entitlementView(snapshot([override('ai.premium', true, 5, 30), override('beta.search', true, -30, -1)]), NOW);
    expect(byCode(view, 'ai.premium')).toBeUndefined();
    expect(byCode(view, 'beta.search')).toBeUndefined();
  });

  it('follows the kernel rule when overrides overlap: the one that started last wins, whatever the order of the rows', () => {
    const older = override('reporting', true, -20, 30, 10);
    const newer = override('reporting', true, -2, 30, 99);
    for (const rows of [[older, newer], [newer, older]]) {
      expect(byCode(entitlementView(snapshot(rows), NOW), 'reporting')).toMatchObject({ limit: '99', source: 'OVERRIDE' });
    }
    // The newer override switches the feature off: the view says so, as the gate does.
    const off = override('reporting', false, -1, 30);
    for (const rows of [[older, off], [off, older]]) {
      expect(byCode(entitlementView(snapshot(rows), NOW), 'reporting')).toMatchObject({ allowed: false, mode: 'DENIED' });
    }
  });

  it('keeps the plan rows, sorted by code, when there is no override', () => {
    const view = entitlementView(snapshot([]), NOW);
    expect(view.features.map((feature) => feature.feature_code)).toEqual([...STANDARD_FEATURES].map((f: FeatureEntry) => f.featureCode).sort());
    expect(view.features.every((feature) => feature.source === 'PLAN')).toBe(true);
    expect(view).toMatchObject({ version_no: 3, license_status: 'FULL' });
  });

  it('shows an override-only feature as denied while the license is in grace, as the gate does (no plan row to follow)', () => {
    const view = entitlementView(snapshot([override('ai.premium', true, -1, 30)], { licenseMode: 'GRACE' }), NOW);
    expect(byCode(view, 'ai.premium')).toMatchObject({ allowed: false, mode: 'DENIED' });
  });
});
