import { describe, expect, it } from 'vitest';
import { DEV_TENANTS, DEV_USER } from './dev-tenants';
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
