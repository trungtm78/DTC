import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_BY_PERMISSION, RISKY_FEATURES, STANDARD_FEATURES, featureOf, isRiskyFeature } from '../src/index';

const CATALOGUE = readFileSync(join(__dirname, '..', '..', 'contracts', 'src', 'permissions.generated.ts'), 'utf8');
const PERMISSIONS = new Set([...CATALOGUE.matchAll(/": "([a-z_.]+)"/g)].map((match) => match[1] ?? ''));

describe('permission to feature mapping', () => {
  it('only maps permissions that exist in the catalogue', () => {
    expect(PERMISSIONS.size).toBeGreaterThan(400);
    for (const permission of Object.keys(FEATURE_BY_PERMISSION)) expect(PERMISSIONS.has(permission)).toBe(true);
  });

  it('only maps to features the STANDARD plan lists', () => {
    const known = new Set(STANDARD_FEATURES.map((entry) => entry.featureCode));
    for (const feature of Object.values(FEATURE_BY_PERMISSION)) expect(known.has(feature)).toBe(true);
  });

  it('covers every STANDARD feature at least once', () => {
    const mapped = new Set(Object.values(FEATURE_BY_PERMISSION));
    for (const entry of STANDARD_FEATURES) expect(mapped.has(entry.featureCode)).toBe(true);
  });

  it('answers featureOf for gated permissions and undefined for ungated ones', () => {
    expect(featureOf('report.export')).toBe('export');
    expect(featureOf('report.read')).toBe('reporting');
    expect(featureOf('notification.campaign.manage')).toBe('notification.campaign');
    expect(featureOf('iam.member.invite')).toBe('member.invite');
    expect(featureOf('ai.invoke')).toBe('ai.analysis');
    expect(featureOf('iam.role.grant')).toBeUndefined();
    expect(featureOf('__proto__')).toBeUndefined();
    expect(featureOf('constructor')).toBeUndefined();
  });

  it('lists the risky features: the premium ones whose commands must read fresh data', () => {
    const known = new Set(STANDARD_FEATURES.map((entry) => entry.featureCode));
    for (const feature of RISKY_FEATURES) expect(known.has(feature)).toBe(true);
    expect([...RISKY_FEATURES].sort()).toEqual(['ai.analysis', 'notification.campaign']);
    expect(isRiskyFeature('ai.analysis')).toBe(true);
    expect(isRiskyFeature('reporting')).toBe(false);
    expect(isRiskyFeature('__proto__')).toBe(false);
  });
});
