import type { LicenseRow } from '@machvon/db';
import { effectiveStatus, systemLicenseView } from '../src/modules/sas/license.controller';

const NOW = new Date('2026-10-23T03:00:00Z');
const DAY_MS = 86_400_000;

function row(overrides: Partial<LicenseRow> = {}): LicenseRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-000000000002',
    serial: 'LIC-20261023-0001',
    revision: 1,
    edition: 'STANDARD',
    status: 'Issued',
    validFrom: new Date(NOW.getTime() - 10 * DAY_MS),
    validUntil: new Date(NOW.getTime() + 100 * DAY_MS),
    graceUntil: new Date(NOW.getTime() + 130 * DAY_MS),
    seats: null,
    quota: {},
    issuer: 'machvon-platform',
    issuedBy: null,
    issuedAt: null,
    statusReason: null,
    deploymentBinding: null,
    offlineLeaseUntil: null,
    keyId: 'kid-1',
    entitlementVersionId: '00000000-0000-4000-8000-000000000003',
    supersedesId: null,
    version: 1,
    signedClaims: 'a.b.c',
    ...overrides,
  };
}

describe('the state of a license revision as the screens read it', () => {
  it.each(['Draft', 'Superseded', 'Suspended'] as const)('keeps the label %s whatever the clock says', (status) => {
    expect(effectiveStatus(row({ status }), NOW)).toBe(status);
  });

  it('follows the clock for the other stored states, and Revoked stays Revoked', () => {
    expect(effectiveStatus(row(), NOW)).toBe('Active');
    expect(effectiveStatus(row({ validFrom: new Date(NOW.getTime() + DAY_MS) }), NOW)).toBe('Scheduled');
    expect(effectiveStatus(row({ validUntil: new Date(NOW.getTime() - DAY_MS) }), NOW)).toBe('Grace');
    expect(effectiveStatus(row({ validUntil: new Date(NOW.getTime() - 2 * DAY_MS), graceUntil: new Date(NOW.getTime() - DAY_MS) }), NOW)).toBe('Expired');
    expect(effectiveStatus(row({ status: 'Revoked', statusReason: 'The contract was terminated.' }), NOW)).toBe('Revoked');
  });
});

describe('the SystemLicense view of the control plane', () => {
  it('carries the signed claims, the signature check and null for what the revision does not have', () => {
    const view = systemLicenseView(row(), NOW, 'UNKNOWN_KEY');
    expect(view).toMatchObject({ signed_claims: 'a.b.c', signature_check: 'UNKNOWN_KEY', status: 'Active', seats: null, issued_by: null, issued_at: null, status_reason: null, offline_lease_until: null, supersedes_id: null, expiring: false, version: 1 });
  });

  it('marks a license that ends within thirty days as expiring and one that is suspended as not', () => {
    const soon = row({ validUntil: new Date(NOW.getTime() + 30 * DAY_MS) });
    expect(systemLicenseView(soon, NOW, 'VALID').expiring).toBe(true);
    expect(systemLicenseView(row({ ...soon, status: 'Suspended', statusReason: 'Suspended for the review of the contract.' }), NOW, 'VALID')).toMatchObject({ expiring: false, status: 'Suspended' });
  });

  it('writes the dates as ISO strings in UTC', () => {
    const view = systemLicenseView(row({ issuedAt: NOW, offlineLeaseUntil: NOW, issuedBy: '00000000-0000-4000-8000-000000000009' }), NOW, 'VALID');
    expect(view).toMatchObject({ issued_at: NOW.toISOString(), offline_lease_until: NOW.toISOString(), valid_from: new Date(NOW.getTime() - 10 * DAY_MS).toISOString(), issued_by: '00000000-0000-4000-8000-000000000009' });
  });
});
