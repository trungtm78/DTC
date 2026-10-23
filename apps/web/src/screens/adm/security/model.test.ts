import { ApiError } from '@machvon/api-client';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CERTIFICATE_VALUES,
  EMPTY_POLICY_VALUES,
  allowlistOf,
  certificateBody,
  daysUntil,
  describeProblem,
  expiryState,
  policyBody,
  toCertificate,
  toPolicy,
  validateCertificate,
  validatePolicy,
} from './model';

const NOW = new Date('2026-10-24T00:00:00Z');
const DAY = 86_400_000;
const at = (days: number): string => new Date(NOW.getTime() + days * DAY).toISOString();

describe('expiryState (the 30-day warning of ADM-08)', () => {
  it.each([
    [31, 'Active', 'ok'],
    [30, 'Active', 'ok'],
    [29.5, 'Active', 'expiring'],
    [1, 'Active', 'expiring'],
    [0.01, 'Active', 'expiring'],
    [0, 'Active', 'expired'],
    [-1, 'Active', 'expired'],
    [-1, 'Expired', 'expired'],
    [10, 'Revoked', 'revoked'],
    [-10, 'Revoked', 'revoked'],
  ])('a certificate ending in %s days that is %s is %s', (days, status, expected) => {
    expect(expiryState({ status: status as 'Active', validUntil: at(days) }, NOW)).toBe(expected);
  });

  it('counts whole days', () => {
    expect(daysUntil(at(12.9), NOW)).toBe(12);
    expect(daysUntil(at(-0.5), NOW)).toBe(-1);
  });
});

describe('mappers', () => {
  it('reads a certificate and ignores a row without an id', () => {
    expect(toCertificate({ id: 'c', kind: 'ORGANIZATION', certificate_serial: '0A', status: 'Revoked', version: 3, valid_until: at(1) })).toMatchObject({ id: 'c', kind: 'ORGANIZATION', serial: '0A', status: 'Revoked', version: 3 });
    expect(toCertificate({ kind: 'PERSONAL' })).toBeUndefined();
    expect(toCertificate('x')).toBeUndefined();
    expect(toCertificate({ id: 'c', status: 'Weird' })?.status).toBe('Active');
  });

  it('reads a policy and tolerates missing optional fields', () => {
    expect(toPolicy({ id: 'p', revision: 2, status: 'Published', mfa_required_roles: ['A', 1, 'B'], session_idle_minutes: 30, session_max_hours: 8 })).toMatchObject({
      revision: 2,
      status: 'Published',
      mfaRequiredRoles: ['A', 'B'],
      ipAllowlist: [],
      downloadTtlMinutes: null,
      exportWatermark: false,
    });
    expect(toPolicy(null)).toBeUndefined();
    expect(toPolicy({ id: 'p', status: 'Weird' })?.status).toBe('Draft');
  });
});

describe('validateCertificate and certificateBody', () => {
  const personal = { ...EMPTY_CERTIFICATE_VALUES, holderMembershipId: 'm', providerCode: ' VNPT-CA ', certificatePem: '  PEM  ' };

  it('asks for the holder of a personal certificate and the unit of an organisation one', () => {
    expect(validateCertificate(EMPTY_CERTIFICATE_VALUES)).toEqual({ holderMembershipId: 'required', providerCode: 'required', certificatePem: 'required' });
    expect(validateCertificate({ ...EMPTY_CERTIFICATE_VALUES, kind: 'ORGANIZATION' })).toMatchObject({ organizationUnitId: 'required' });
    expect(validateCertificate(personal)).toEqual({});
  });

  it('refuses too long provider codes and certificate text', () => {
    expect(validateCertificate({ ...personal, providerCode: 'x'.repeat(41) }).providerCode).toBe('tooLong');
    expect(validateCertificate({ ...personal, certificatePem: 'x'.repeat(20_001) }).certificatePem).toBe('tooLong');
    expect(validateCertificate({ ...personal, certificatePem: 'x'.repeat(20_000) })).toEqual({});
  });

  it('sends only the field of the kind and trims the text', () => {
    expect(certificateBody(personal)).toEqual({ kind: 'PERSONAL', holder_membership_id: 'm', certificate_pem: 'PEM', provider_code: 'VNPT-CA' });
    expect(certificateBody({ ...personal, kind: 'ORGANIZATION', organizationUnitId: 'u' })).toEqual({ kind: 'ORGANIZATION', organization_unit_id: 'u', certificate_pem: 'PEM', provider_code: 'VNPT-CA' });
  });
});

describe('validatePolicy and policyBody', () => {
  it('accepts the defaults and the edges of the ranges', () => {
    expect(validatePolicy(EMPTY_POLICY_VALUES)).toEqual({});
    expect(validatePolicy({ ...EMPTY_POLICY_VALUES, sessionIdleMinutes: '5', sessionMaxHours: '1' })).toEqual({});
    expect(validatePolicy({ ...EMPTY_POLICY_VALUES, sessionIdleMinutes: '240', sessionMaxHours: '24', downloadTtlMinutes: '1440' })).toEqual({});
  });

  it.each([
    [{ sessionIdleMinutes: '4' }, 'sessionIdleMinutes', 'range'],
    [{ sessionIdleMinutes: '241' }, 'sessionIdleMinutes', 'range'],
    [{ sessionMaxHours: '0' }, 'sessionMaxHours', 'range'],
    [{ sessionMaxHours: '25' }, 'sessionMaxHours', 'range'],
    [{ sessionIdleMinutes: '' }, 'sessionIdleMinutes', 'required'],
    [{ sessionMaxHours: '1.5' }, 'sessionMaxHours', 'required'],
    [{ sessionIdleMinutes: '180', sessionMaxHours: '2' }, 'sessionIdleMinutes', 'order'],
    [{ downloadTtlMinutes: '0' }, 'downloadTtlMinutes', 'range'],
    [{ downloadTtlMinutes: 'abc' }, 'downloadTtlMinutes', 'range'],
  ])('refuses %j', (override, field, problem) => {
    expect(validatePolicy({ ...EMPTY_POLICY_VALUES, ...override })[field as 'sessionMaxHours']).toBe(problem);
  });

  it('accepts an idle time exactly as long as the session and refuses more than 200 allowlist lines', () => {
    expect(validatePolicy({ ...EMPTY_POLICY_VALUES, sessionIdleMinutes: '120', sessionMaxHours: '2' })).toEqual({});
    expect(validatePolicy({ ...EMPTY_POLICY_VALUES, ipAllowlist: Array.from({ length: 201 }, (_unused, n) => `10.0.0.${n}`).join('\n') }).ipAllowlist).toBe('tooLong');
  });

  it('builds the body without empty optional fields and with a trimmed allowlist', () => {
    expect(policyBody(EMPTY_POLICY_VALUES)).toEqual({ mfa_required_roles: [], session_idle_minutes: 30, session_max_hours: 8, export_watermark: false });
    expect(policyBody({ ...EMPTY_POLICY_VALUES, ipAllowlist: ' 10.0.0.1 \r\n\r\n10.0.0.2', downloadTtlMinutes: '15', mfaRequiredRoles: ['LEADER'] })).toEqual({
      mfa_required_roles: ['LEADER'],
      session_idle_minutes: 30,
      session_max_hours: 8,
      ip_allowlist: ['10.0.0.1', '10.0.0.2'],
      download_ttl_minutes: 15,
      export_watermark: false,
    });
    expect(allowlistOf('')).toEqual([]);
  });
});

describe('describeProblem', () => {
  it.each([
    ['CERTIFICATE_INVALID', 'certificateInvalid'],
    ['CERTIFICATE_EXPIRED', 'certificateExpired'],
    ['CERTIFICATE_DUPLICATE', 'certificateDuplicate'],
    ['POLICY_INVALID', 'policyInvalid'],
    ['SELF_APPROVAL_DENIED', 'selfApproval'],
    ['VERSION_CONFLICT', 'conflict'],
    ['STAGE_TRANSITION_DENIED', 'stage'],
    ['VALIDATION_FAILED', 'invalid'],
    ['RESOURCE_NOT_FOUND', 'notFound'],
    ['SCOPE_DENIED', 'denied'],
    ['SESSION_EXPIRED', 'session'],
    ['SOMETHING_ELSE', 'general'],
  ])('maps %s to %s', (code, reason) => {
    expect(describeProblem(new ApiError({ status: 400, code, correlationId: 'c', detail: 'f' }))).toEqual({ reason, field: 'f' });
  });

  it('treats a failure that is not an API error as general', () => {
    expect(describeProblem(new Error('x'))).toEqual({ reason: 'general', field: undefined });
  });
});
