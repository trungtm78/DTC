import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_ROLES, activeGrants, controlAccessOf, decide, effectivePermissions, holdsPermission } from '../src/index';

const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';
const NOW = new Date('2026-10-23T08:00:00Z');
const CATALOGUE = readFileSync(join(__dirname, '..', '..', 'contracts', 'src', 'permissions.generated.ts'), 'utf8');
const SYSTEM_PERMISSIONS = [...new Set([...CATALOGUE.matchAll(/"(system\.[a-z_.]+)"/g)].map((match) => match[1] ?? ''))].sort();

const holds = (roles: readonly string[], permission: string): boolean =>
  holdsPermission(effectivePermissions(controlAccessOf(roles, MEMBERSHIP), NOW), permission);

describe('control-plane roles', () => {
  it('the catalogue has the system permissions this test is built on', () => {
    expect(SYSTEM_PERMISSIONS).toEqual([
      'system.billing.manage',
      'system.license.manage',
      'system.release.manage',
      'system.support.request',
      'system.tenant.manage',
      'system.tenant.read',
      'system.theme.manage',
    ]);
  });

  it('lets SystemAdmin hold every system permission of the catalogue', () => {
    for (const permission of SYSTEM_PERMISSIONS) expect(holds(['SystemAdmin'], permission)).toBe(true);
    expect(holds(['SystemAdmin'], 'system.anything.new')).toBe(true);
  });

  it('never gives a control role a tenant-plane permission', () => {
    for (const role of Object.keys(CONTROL_ROLES)) {
      expect(holds([role], 'iam.role.grant')).toBe(false);
      expect(holds([role], 'organization_unit.read')).toBe(false);
    }
  });

  it('keeps PlatformOperator read only', () => {
    expect(holds(['PlatformOperator'], 'system.tenant.read')).toBe(true);
    expect(holds(['PlatformOperator'], 'system.tenant.manage')).toBe(false);
    expect(holds(['PlatformOperator'], 'system.billing.manage')).toBe(false);
  });

  it('gives BillingOperator billing and tenant reads but no lifecycle or license rights', () => {
    expect(holds(['BillingOperator'], 'system.billing.manage')).toBe(true);
    expect(holds(['BillingOperator'], 'system.tenant.read')).toBe(true);
    expect(holds(['BillingOperator'], 'system.tenant.manage')).toBe(false);
    expect(holds(['BillingOperator'], 'system.license.manage')).toBe(false);
  });

  it('gives SupportOperator only the support request', () => {
    expect(holds(['SupportOperator'], 'system.support.request')).toBe(true);
    expect(holds(['SupportOperator'], 'system.tenant.read')).toBe(false);
  });

  it('only lists permissions that exist in the catalogue, except the SystemAdmin pattern', () => {
    for (const [role, permissions] of Object.entries(CONTROL_ROLES)) {
      for (const permission of permissions) {
        if (role === 'SystemAdmin') expect(permission).toBe('system.*');
        else expect(SYSTEM_PERMISSIONS).toContain(permission);
      }
    }
  });

  it('adds the permissions of several roles and ignores unknown ones', () => {
    expect(holds(['PlatformOperator', 'SupportOperator'], 'system.support.request')).toBe(true);
    expect(holds(['PlatformOperator', 'SupportOperator'], 'system.tenant.read')).toBe(true);
    expect(holds(['PlatformOperator', 'Root', '__proto__', 'constructor'], 'system.tenant.manage')).toBe(false);
    expect(controlAccessOf(['PlatformOperator', 'PlatformOperator'], MEMBERSHIP).grants).toHaveLength(1);
  });

  it('gives an inactive access with no grants for empty or entirely unknown roles', () => {
    for (const roles of [[], ['Root'], ['toString']]) {
      const access = controlAccessOf(roles, MEMBERSHIP);
      expect(access.membershipActive).toBe(false);
      expect(access.grants).toEqual([]);
      expect(activeGrants(access, NOW)).toEqual([]);
    }
  });

  it('builds one tenant-wide grant per known role, effective from the beginning of time', () => {
    const access = controlAccessOf(['BillingOperator', 'SystemAdmin'], MEMBERSHIP);
    expect(access.membershipId).toBe(MEMBERSHIP);
    expect(access.membershipActive).toBe(true);
    expect(access.grants.map((grant) => grant.roleCode).sort()).toEqual(['BillingOperator', 'SystemAdmin']);
    for (const grant of access.grants) {
      expect(grant.scope).toEqual({ kind: 'TENANT' });
      expect(grant.status).toBe('Active');
      expect(grant.effectiveUntil).toBeNull();
      expect(grant.effectiveFrom.getTime()).toBe(0);
    }
  });

  it('works with decide() for the control plane and refuses a tenant-plane token', () => {
    const access = controlAccessOf(['PlatformOperator'], MEMBERSHIP);
    const principal = { audience: 'control' as const, assurance: 'aal2' as const, sessionRevoked: false, tokenScopeVersion: 0 };
    expect(decide({ required: { permission: 'system.tenant.read', plane: 'control' }, principal, access, now: NOW })).toEqual({ allow: true });
    expect(decide({ required: { permission: 'system.tenant.manage', plane: 'control' }, principal, access, now: NOW })).toMatchObject({
      allow: false,
      reason: 'NO_PERMISSION',
    });
    expect(
      decide({ required: { permission: 'system.tenant.read', plane: 'control' }, principal: { ...principal, audience: 'tenant' }, access, now: NOW }),
    ).toMatchObject({ allow: false, reason: 'PLANE' });
  });
});
