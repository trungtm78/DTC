import { describe, expect, it } from 'vitest';
import { assignablePermissions, groupPermissions, permissionOf, togglePermission } from './permission-groups';

describe('groupPermissions', () => {
  it('groups by resource (every segment but the last) and lists the actions in order', () => {
    expect(groupPermissions(['iam.role.manage', 'iam.role.grant', 'iam.unit.manage', 'notification.self'])).toEqual([
      { resource: 'iam.role', actions: ['grant', 'manage'] },
      { resource: 'iam.unit', actions: ['manage'] },
      { resource: 'notification', actions: ['self'] },
    ]);
  });

  it('keeps a wildcard pattern as the action * of its prefix, listed before the named actions', () => {
    expect(groupPermissions(['iam.role.grant', 'iam.*', 'iam.unit.*'])).toEqual([
      { resource: 'iam', actions: ['*'] },
      { resource: 'iam.role', actions: ['grant'] },
      { resource: 'iam.unit', actions: ['*'] },
    ]);
  });

  it('never lists a system permission or the pattern system.*', () => {
    expect(groupPermissions(['system.tenant.manage', 'system.*', 'system.theme.manage', 'iam.role.grant'])).toEqual([
      { resource: 'iam.role', actions: ['grant'] },
    ]);
  });

  it('drops duplicates and gives the same order for any input order', () => {
    const a = groupPermissions(['b.x.read', 'a.y.write', 'b.x.read', 'a.y.read']);
    const b = groupPermissions(['a.y.read', 'a.y.write', 'b.x.read']);
    expect(a).toEqual(b);
    expect(a).toEqual([
      { resource: 'a.y', actions: ['read', 'write'] },
      { resource: 'b.x', actions: ['read'] },
    ]);
  });

  it('puts a permission without a dot under its own name as the resource and the action self', () => {
    expect(groupPermissions(['standalone'])).toEqual([{ resource: 'standalone', actions: ['self'] }]);
  });

  it('is empty for no permissions', () => {
    expect(groupPermissions([])).toEqual([]);
  });
});

describe('permissionOf', () => {
  it('joins a resource and an action back into the permission name', () => {
    expect(permissionOf('iam.role', 'grant')).toBe('iam.role.grant');
    expect(permissionOf('iam', '*')).toBe('iam.*');
    expect(permissionOf('standalone', 'self')).toBe('standalone');
  });
});

describe('togglePermission', () => {
  it('adds a missing permission and removes a present one, keeping the list sorted and unique', () => {
    expect(togglePermission(['b.x.read'], 'a.y.read')).toEqual(['a.y.read', 'b.x.read']);
    expect(togglePermission(['a.y.read', 'b.x.read'], 'a.y.read')).toEqual(['b.x.read']);
  });
});

describe('assignablePermissions', () => {
  it('lists the tenant-plane permissions of the contract, without system permissions, sorted and unique', () => {
    const permissions = assignablePermissions();
    expect(permissions.length).toBeGreaterThan(100);
    expect(permissions.some((permission) => permission.startsWith('system.'))).toBe(false);
    expect(permissions).toEqual([...new Set(permissions)].sort());
    expect(permissions).toContain('iam.role.grant');
    expect(permissions).toContain('role_grant.read');
  });
});
