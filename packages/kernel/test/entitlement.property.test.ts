import * as fc from 'fast-check';
import { STANDARD_FEATURES, allowedFeature, entitlementsHash } from '../src/index';
import type { FeatureEntry, LicenseMode, Override } from '../src/index';

const NOW = new Date('2026-10-23T08:00:00Z');
const MODES: readonly LicenseMode[] = ['FULL', 'GRACE', 'EXPIRED', 'SUSPENDED', 'REVOKED'];
const KINDS = ['read', 'write', 'export'] as const;
const POLICIES = ['FULL', 'READ_ONLY_EXPORT', 'NO_ACCESS'] as const;
const CODES = ['reporting', 'export', 'ai.analysis', 'extra'];

const featureEntry = fc.record({
  featureCode: fc.constantFrom(...CODES),
  limitKind: fc.constantFrom('BOOLEAN', 'QUOTA', 'METERED') as fc.Arbitrary<FeatureEntry['limitKind']>,
  limitValue: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  graceBehavior: fc.constantFrom('ALLOW', 'READ_ONLY', 'DENY') as fc.Arbitrary<FeatureEntry['graceBehavior']>,
  expiredBehavior: fc.constantFrom('READ_ONLY', 'EXPORT_ONLY', 'DENY') as fc.Arbitrary<FeatureEntry['expiredBehavior']>,
});

const overrideArb = fc.record({
  featureCode: fc.constantFrom(...CODES),
  enabled: fc.boolean(),
  validFrom: fc.integer({ min: -48, max: 48 }).map((hours) => new Date(NOW.getTime() + hours * 3_600_000)),
  validUntil: fc.integer({ min: -48, max: 48 }).map((hours) => new Date(NOW.getTime() + hours * 3_600_000)),
  status: fc.constantFrom('PendingApproval', 'Active', 'Revoked', 'Expired', 'Rejected'),
}) as fc.Arbitrary<Override>;

const inputs = fc.record({
  features: fc.array(featureEntry, { maxLength: 6 }),
  overrides: fc.array(overrideArb, { maxLength: 4 }),
  licenseMode: fc.constantFrom(...MODES),
  tenantPolicy: fc.constantFrom(...POLICIES),
  feature: fc.constantFrom(...CODES),
  operationKind: fc.constantFrom(...KINDS),
});

describe('allowedFeature properties', () => {
  it('never allows a write when the license is expired, suspended or revoked', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        if (input.operationKind !== 'write' || input.licenseMode === 'FULL' || input.licenseMode === 'GRACE') return true;
        return !allowedFeature({ ...input, now: NOW }).allowed;
      }),
      { numRuns: 500 },
    );
  });

  it('never allows anything under NO_ACCESS and never allows a write under READ_ONLY_EXPORT', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const result = allowedFeature({ ...input, now: NOW });
        if (input.tenantPolicy === 'NO_ACCESS') return !result.allowed;
        if (input.tenantPolicy === 'READ_ONLY_EXPORT' && input.operationKind === 'write') return !result.allowed;
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it('is a pure function of its input and always explains a denial', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const first = allowedFeature({ ...input, now: NOW });
        const second = allowedFeature({ ...input, now: NOW });
        return JSON.stringify(first) === JSON.stringify(second) && (first.allowed || first.reason !== undefined);
      }),
      { numRuns: 300 },
    );
  });

  it('allows a feature only when the plan or an active override switches it on', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        if (!allowedFeature({ ...input, now: NOW }).allowed) return true;
        const entry = input.features.find((candidate) => candidate.featureCode === input.feature);
        const planOn = entry !== undefined && (entry.limitValue === undefined || entry.limitValue > 0);
        const active = input.overrides.some(
          (candidate) =>
            candidate.featureCode === input.feature &&
            candidate.status === 'Active' &&
            candidate.validFrom.getTime() <= NOW.getTime() &&
            NOW.getTime() < candidate.validUntil.getTime(),
        );
        return planOn || active;
      }),
      { numRuns: 500 },
    );
  });

  it('hashes any permutation of the entries identically', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...STANDARD_FEATURES], { minLength: 1 }), (subset) => {
        return entitlementsHash(subset) === entitlementsHash([...subset].reverse());
      }),
    );
  });
});
