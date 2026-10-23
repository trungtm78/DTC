import { DomainError } from '../src/errors.ts';
import { validateSecurityPolicy } from '../src/security-policy.ts';
import type { SecurityPolicyContent } from '../src/security-policy.ts';

const ROLES = new Set(['LEADER', 'SECURITY_ADMIN', 'TENANT_ADMIN', 'TENANT_OWNER', 'AUDITOR']);
const GOOD: SecurityPolicyContent = { mfa_required_roles: ['LEADER', 'TENANT_ADMIN'], session_idle_minutes: 30, session_max_hours: 8 };

function failure(content: SecurityPolicyContent): DomainError {
  try {
    validateSecurityPolicy(content, ROLES);
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

describe('validateSecurityPolicy', () => {
  it('accepts a policy whose roles exist and whose limits agree', () => {
    expect(() => validateSecurityPolicy(GOOD, ROLES)).not.toThrow();
    expect(() => validateSecurityPolicy({ ...GOOD, ip_allowlist: ['10.0.0.0/8', '203.0.113.7', '2001:db8::/32', '::1'], download_ttl_minutes: 15, export_watermark: true }, ROLES)).not.toThrow();
  });

  it('accepts an idle limit exactly equal to the maximum session length', () => {
    expect(() => validateSecurityPolicy({ ...GOOD, session_idle_minutes: 240, session_max_hours: 4 }, ROLES)).not.toThrow();
  });

  it('refuses an idle limit longer than the session itself, naming the field', () => {
    expect(failure({ ...GOOD, session_idle_minutes: 241, session_max_hours: 4 })).toMatchObject({ code: 'POLICY_INVALID', status: 422, detail: 'session_idle_minutes' });
  });

  it('refuses a role that does not exist in the tenant without echoing it', () => {
    const error = failure({ ...GOOD, mfa_required_roles: ['LEADER', 'SECRET_ROLE_NAME'] });
    expect(error).toMatchObject({ code: 'POLICY_INVALID', detail: 'mfa_required_roles' });
    expect(JSON.stringify([error.message, error.detail])).not.toContain('SECRET_ROLE_NAME');
  });

  it('refuses a role listed twice', () => {
    expect(failure({ ...GOOD, mfa_required_roles: ['LEADER', 'LEADER'] })).toMatchObject({ code: 'POLICY_INVALID', detail: 'mfa_required_roles' });
  });

  it.each(['10.0.0.256', '10.0.0.0/33', '2001:db8::/129', 'not-an-address', '10.0.0.0/', '10.0.0.0/-1', '10.0.0.0/08x', ' 10.0.0.1', '10.0.0.1 '])(
    'refuses the address list entry %p',
    (entry) => {
      expect(failure({ ...GOOD, ip_allowlist: [entry] })).toMatchObject({ code: 'POLICY_INVALID', detail: 'ip_allowlist' });
    },
  );

  it('refuses the same address twice and more than 200 entries', () => {
    expect(failure({ ...GOOD, ip_allowlist: ['10.0.0.1', '10.0.0.1'] })).toMatchObject({ detail: 'ip_allowlist' });
    const many = Array.from({ length: 201 }, (_unused, n) => `10.0.${Math.floor(n / 250)}.${n % 250}`);
    expect(failure({ ...GOOD, ip_allowlist: many })).toMatchObject({ detail: 'ip_allowlist' });
  });
});
