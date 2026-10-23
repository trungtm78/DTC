import { ApiError } from '@machvon/api-client';
import { describe, expect, it } from 'vitest';
import vi_ from '../../../i18n/vi.json';
import { statusLabel, statusTone } from './labels';
import { describeProblem } from './problems';
import { EMPTY_ISSUE_VALUES, issueBody, isLicenseAction, isReasonValid, licenseActions, validateIssueForm } from './rules';
import type { IssueValues } from './rules';
import { LICENSE_STATUSES, toLicense, toLicensePage } from './types';

const NOW = new Date('2026-10-23T03:00:00Z');
const TENANT = '00000000-0000-4000-8000-0000000000a1';
const VERSION = '00000000-0000-4000-8000-0000000000b1';

const valid = (overrides: Partial<IssueValues> = {}): IssueValues => ({
  ...EMPTY_ISSUE_VALUES,
  tenant_id: TENANT,
  valid_from: '2026-10-24',
  valid_until: '2027-10-24',
  grace_until: '2027-11-23',
  ...overrides,
});

describe('the rules of the issue form (BR-SAS-11)', () => {
  it('accepts a window with from < until <= grace, a tenant with an entitlement version and no seats', () => {
    expect(validateIssueForm(valid(), VERSION, NOW)).toEqual({});
  });

  it('accepts a grace period that ends the same day as the license', () => {
    expect(validateIssueForm(valid({ grace_until: '2027-10-24' }), VERSION, NOW)).toEqual({});
  });

  it('asks for a tenant, the three dates and an entitlement version', () => {
    const errors = validateIssueForm({ ...EMPTY_ISSUE_VALUES }, undefined, NOW);
    expect(errors).toEqual({ tenant_id: 'required', valid_from: 'required', valid_until: 'required', grace_until: 'required' });
    expect(validateIssueForm(valid(), undefined, NOW)).toEqual({ entitlement_version_id: 'entitlement' });
  });

  it('refuses a tenant that is no identifier and an edition that is not offered', () => {
    expect(validateIssueForm(valid({ tenant_id: 'cao-bang' }), VERSION, NOW)).toEqual({ tenant_id: 'uuid' });
    expect(validateIssueForm(valid({ edition: 'GOLD' }), VERSION, NOW)).toEqual({ edition: 'choice' });
  });

  it.each([
    ['from is not before until', { valid_from: '2027-10-24' }, { valid_until: 'window' }],
    ['until is before from', { valid_from: '2028-01-01' }, { valid_until: 'window' }],
    ['the window has ended already', { valid_from: '2025-01-01', valid_until: '2026-10-22', grace_until: '2026-12-01' }, { valid_until: 'past' }],
    ['grace ends before the license', { grace_until: '2027-10-01' }, { grace_until: 'grace' }],
    ['a date is not a date', { valid_from: '2026-13-45' }, { valid_from: 'date' }],
    ['a date has the wrong shape', { grace_until: '24/12/2027' }, { grace_until: 'date' }],
  ] as const)('refuses a window where %s', (_label, overrides, expected) => {
    expect(validateIssueForm(valid(overrides), VERSION, NOW)).toEqual(expected);
  });

  it.each([['0'], ['-3'], ['1.5'], ['ten']])('refuses %s seats', (seats) => {
    expect(validateIssueForm(valid({ seats }), VERSION, NOW)).toEqual({ seats: 'seats' });
  });

  it('accepts a whole number of seats', () => {
    expect(validateIssueForm(valid({ seats: ' 50 ' }), VERSION, NOW)).toEqual({});
  });

  it('checks the offline lease only for a private deployment: 0 to 30 whole days', () => {
    expect(validateIssueForm(valid({ edition: 'PRIVATE', offline_lease_days: '30' }), VERSION, NOW)).toEqual({});
    expect(validateIssueForm(valid({ edition: 'PRIVATE', offline_lease_days: '0' }), VERSION, NOW)).toEqual({});
    expect(validateIssueForm(valid({ edition: 'PRIVATE', offline_lease_days: '31' }), VERSION, NOW)).toEqual({ offline_lease_days: 'lease' });
    expect(validateIssueForm(valid({ edition: 'PRIVATE', offline_lease_days: '2.5' }), VERSION, NOW)).toEqual({ offline_lease_days: 'lease' });
    expect(validateIssueForm(valid({ edition: 'STANDARD', offline_lease_days: '99' }), VERSION, NOW)).toEqual({});
  });
});

describe('the request body of the issue form', () => {
  it('writes the dates at 00:00 UTC, sends the version of the entitlement and leaves the optional fields out', () => {
    expect(issueBody(valid(), VERSION)).toEqual({
      tenant_id: TENANT,
      edition: 'STANDARD',
      valid_from: '2026-10-24T00:00:00.000Z',
      valid_until: '2027-10-24T00:00:00.000Z',
      grace_until: '2027-11-23T00:00:00.000Z',
      entitlement_version_id: VERSION,
    });
  });

  it('sends the seats as a number and the private-deployment fields only for the PRIVATE edition', () => {
    const body = issueBody(valid({ seats: '50', edition: 'PRIVATE', deployment_binding: ' site-7 ', offline_lease_days: '14' }), VERSION);
    expect(body).toMatchObject({ seats: 50, edition: 'PRIVATE', deployment_binding: 'site-7', offline_lease_days: 14 });
    const standard = issueBody(valid({ edition: 'STANDARD', deployment_binding: 'site-7', offline_lease_days: '14' }), VERSION);
    expect(standard).not.toHaveProperty('deployment_binding');
    expect(standard).not.toHaveProperty('offline_lease_days');
    expect(issueBody(valid({ edition: 'PRIVATE' }), VERSION)).not.toHaveProperty('deployment_binding');
  });

  it('never carries claims: the body has only the fields of LicenseIssue', () => {
    const allowed = ['tenant_id', 'edition', 'valid_from', 'valid_until', 'grace_until', 'entitlement_version_id', 'seats', 'deployment_binding', 'offline_lease_days'];
    expect(Object.keys(issueBody(valid({ seats: '5', edition: 'PRIVATE', deployment_binding: 'x', offline_lease_days: '1' }), VERSION)).every((key) => allowed.includes(key))).toBe(true);
  });
});

describe('the changes of state a license allows', () => {
  it.each([
    ['Scheduled', ['suspend', 'revoke']],
    ['Active', ['suspend', 'revoke']],
    ['Grace', ['suspend', 'revoke']],
    ['Suspended', ['reinstate', 'revoke']],
    ['Expired', []],
    ['Revoked', []],
    ['Superseded', []],
    ['Draft', []],
  ] as const)('offers %s: %j', (status, expected) => {
    expect(licenseActions(status, true)).toEqual(expected);
  });

  it('offers nothing to a person who may not manage licenses', () => {
    for (const status of LICENSE_STATUSES) expect(licenseActions(status, false)).toEqual([]);
  });

  it('knows the three actions and nothing else, and a reason of 10 to 2000 characters', () => {
    expect(['suspend', 'reinstate', 'revoke', 'renew', ''].map(isLicenseAction)).toEqual([true, true, true, false, false]);
    expect([isReasonValid('too short'), isReasonValid('  ten chars!  '), isReasonValid('x'.repeat(2001)), isReasonValid('x'.repeat(2000))]).toEqual([false, true, false, true]);
  });
});

describe('the states of a license on the screens', () => {
  const key = (status: string): string => status.toLowerCase();

  it('tells the five states of the clock apart by label, and every state has a catalogue entry', () => {
    const labels = new Set<string>();
    for (const status of LICENSE_STATUSES) {
      const catalogue = (vi_ as Record<string, string>)[`sas.license.status.${key(status)}`];
      expect(catalogue).toBeTruthy();
      labels.add(catalogue ?? '');
    }
    expect(labels.size).toBe(LICENSE_STATUSES.length);
  });

  it('gives a state the server may add later the text the server wrote', () => {
    expect(statusLabel((k) => k, 'Quarantined')).toBe('Quarantined');
    expect(statusTone('Quarantined')).toBe('gray');
  });

  it('colours active green, the waiting and held states amber, the ended states red and the history grey', () => {
    expect([statusTone('Active'), statusTone('Grace'), statusTone('Scheduled'), statusTone('Suspended'), statusTone('Expired'), statusTone('Revoked'), statusTone('Superseded'), statusTone('Draft')]).toEqual([
      'ok',
      'warn',
      'warn',
      'warn',
      'red',
      'red',
      'gray',
      'gray',
    ]);
  });
});

describe('what a license command failure is shown as', () => {
  const failure = (code: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}): ApiError => new ApiError({ status: 422, code, correlationId: 'c', ...extra });

  it.each([
    ['LICENSE_RANGE_INVALID', 'rangeInvalid'],
    ['LICENSE_TENANT_MISMATCH', 'tenantMismatch'],
    ['TENANT_STATE_INVALID', 'tenantState'],
    ['SIGNING_KEY_UNAVAILABLE', 'signingKey'],
    ['LICENSE_STATE_INVALID', 'stateInvalid'],
    ['VALIDATION_FAILED', 'invalid'],
    ['FIELD_NOT_ALLOWED', 'fieldNotAllowed'],
    ['RESOURCE_NOT_FOUND', 'notFound'],
    ['SCOPE_DENIED', 'denied'],
    ['MFA_REQUIRED', 'stepUp'],
    ['SESSION_EXPIRED', 'session'],
    ['SOMETHING_NEW', 'general'],
  ])('maps %s to %s', (code, reason) => {
    expect(describeProblem(failure(code)).reason).toBe(reason);
  });

  it('names the version a stale command lost against, and the field a refusal is about', () => {
    expect(describeProblem(failure('VERSION_CONFLICT', { extensions: { current_version: 4 } }))).toMatchObject({ reason: 'conflict', currentVersion: 4 });
    expect(describeProblem(failure('VERSION_CONFLICT'))).toMatchObject({ reason: 'conflict', currentVersion: undefined });
    expect(describeProblem(failure('LICENSE_RANGE_INVALID', { detail: 'valid_from' }))).toMatchObject({ field: 'valid_from' });
    expect(describeProblem(failure('LICENSE_RANGE_INVALID', { detail: 'something else' }))).toMatchObject({ field: undefined });
    expect(describeProblem(failure('LICENSE_TENANT_MISMATCH'))).toMatchObject({ field: 'entitlement_version_id' });
    expect(describeProblem(failure('TENANT_STATE_INVALID'))).toMatchObject({ field: 'tenant_id' });
  });

  it('shows anything that is no API error as the general failure', () => {
    expect(describeProblem(new Error('boom'))).toEqual({ reason: 'general', field: undefined, currentVersion: undefined });
  });
});

describe('reading a license from the contract', () => {
  it('maps every field and keeps what is missing as undefined', () => {
    const license = toLicense({
      id: 'l1',
      tenant_id: 't1',
      serial: 'LIC-1',
      revision: 2,
      edition: 'PRIVATE',
      status: 'Suspended',
      valid_from: 'a',
      valid_until: 'b',
      grace_until: 'c',
      seats: 5,
      status_reason: 'Held for the review.',
      deployment_binding: 'site',
      offline_lease_until: 'd',
      key_id: 'kid',
      entitlement_version_id: 'e1',
      supersedes_id: 'l0',
      signature_check: 'VALID',
      expiring: true,
      version: 3,
    });
    expect(license).toMatchObject({ id: 'l1', tenantId: 't1', revision: 2, seats: 5, statusReason: 'Held for the review.', supersedesId: 'l0', signatureCheck: 'VALID', expiring: true, version: 3 });
    expect(toLicense({})).toMatchObject({ id: '', revision: 0, seats: undefined, statusReason: undefined, expiring: false, version: 0 });
    expect(toLicense(undefined).serial).toBe('');
  });

  it('reads a page with its cursor, and an empty page for an answer without items', () => {
    expect(toLicensePage({ items: [{ id: 'a' }, { id: 'b' }], next_cursor: 'next' })).toMatchObject({ nextCursor: 'next', items: [{ id: 'a' }, { id: 'b' }] });
    expect(toLicensePage({ items: [], next_cursor: null })).toEqual({ items: [], nextCursor: undefined });
    expect(toLicensePage({})).toEqual({ items: [], nextCursor: undefined });
  });
});
