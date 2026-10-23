import { describe, expect, it } from 'vitest';
import { DEV_TENANTS, DEV_USER, PLATFORM_TENANT } from './dev-tenants';
import { applyDevUser, devUserFor, parseDevUsers } from './dev-users';

const OWNER = { key: 'owner', displayName: 'Chủ tenant', membershipId: '00000000-0000-4000-8000-0000000000e1', permissions: null };
const AUDITOR = { key: 'auditor', displayName: 'Kiểm toán', membershipId: '00000000-0000-4000-8000-0000000000e3', permissions: ['role_grant.read'] };
const JSON_USERS = JSON.stringify([OWNER, AUDITOR]);

describe('parseDevUsers', () => {
  it('reads the fixture users from the environment text', () => {
    expect(parseDevUsers(JSON_USERS)).toEqual([OWNER, AUDITOR]);
  });

  it.each([undefined, '', 'not json', '{"a":1}', '[{"key":"x"}]', '[{"key":1,"displayName":"a","membershipId":"b","permissions":null}]'])('gives no users for %j', (text) => {
    expect(parseDevUsers(text)).toEqual([]);
  });
});

describe('initials', () => {
  it('uses the initials a fixture states and refuses non-text ones', () => {
    const stated = { ...OWNER, initials: 'AN' };
    expect(parseDevUsers(JSON.stringify([stated]))).toEqual([stated]);
    expect(applyDevUser(stated, DEV_TENANTS).user.initials).toBe('AN');
    expect(parseDevUsers(JSON.stringify([{ ...OWNER, initials: 5 }]))).toEqual([]);
  });
});

describe('devUserFor', () => {
  const users = parseDevUsers(JSON_USERS);

  it('picks the user named by ?devUser=', () => {
    expect(devUserFor('?devUser=auditor', users)).toEqual(AUDITOR);
    expect(devUserFor('?tenants=2&devUser=owner', users)).toEqual(OWNER);
  });

  it('gives nobody for an unknown name or no query', () => {
    expect(devUserFor('?devUser=ghost', users)).toBeUndefined();
    expect(devUserFor('', users)).toBeUndefined();
  });
});

describe('applyDevUser', () => {
  it('keeps the default user and tenants when nobody is picked', () => {
    expect(applyDevUser(undefined, DEV_TENANTS)).toEqual({ user: DEV_USER, tenants: DEV_TENANTS, permissions: undefined });
  });

  it('gives every tenant the membership of the picked user, a user of its own name, and its permissions (null means unknown)', () => {
    const picked = applyDevUser(AUDITOR, DEV_TENANTS);
    expect(picked.tenants.map((tenant) => tenant.membershipId)).toEqual([AUDITOR.membershipId, AUDITOR.membershipId]);
    expect(picked.tenants[0]?.name).toBe(DEV_TENANTS[0]?.name);
    expect(picked.user).toMatchObject({ displayName: 'Kiểm toán', initials: 'KT' });
    expect(picked.permissions).toEqual(['role_grant.read']);
    expect(applyDevUser(OWNER, DEV_TENANTS).permissions).toBeUndefined();
  });
});

describe('control-plane fixture users', () => {
  const SYSTEM_ADMIN = { key: 'sysAdmin', displayName: 'System admin', membershipId: '00000000-0000-4000-8000-0000000000e9', permissions: ['system.tenant.read', 'system.tenant.manage'], audience: 'control', roles: ['SystemAdmin'] };

  it('reads the audience and the roles and refuses ones that are not text', () => {
    expect(parseDevUsers(JSON.stringify([SYSTEM_ADMIN]))).toEqual([SYSTEM_ADMIN]);
    expect(parseDevUsers(JSON.stringify([{ ...SYSTEM_ADMIN, audience: 'tenant' }]))).toEqual([]);
    expect(parseDevUsers(JSON.stringify([{ ...SYSTEM_ADMIN, roles: [1] }]))).toEqual([]);
    expect(parseDevUsers(JSON.stringify([{ ...SYSTEM_ADMIN, roles: 'SystemAdmin' }]))).toEqual([]);
  });

  it('signs a control user in on the platform tenant with its own membership and roles', () => {
    const [user] = parseDevUsers(JSON.stringify([SYSTEM_ADMIN]));
    const applied = applyDevUser(user, DEV_TENANTS);
    expect(applied.tenants).toEqual([{ ...PLATFORM_TENANT, membershipId: SYSTEM_ADMIN.membershipId }]);
    expect(applied.controlRoles).toEqual(['SystemAdmin']);
    expect(applied.permissions).toEqual(SYSTEM_ADMIN.permissions);
    expect(applyDevUser(parseDevUsers(JSON_USERS)[0], DEV_TENANTS).controlRoles).toBeUndefined();
    expect(applyDevUser(undefined, DEV_TENANTS).controlRoles).toBeUndefined();
  });
});
