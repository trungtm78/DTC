import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { MemberStore } from '../src/member-store';
import { seedSystemRoles } from '../src/system-roles';
import type { TenantTx } from '../src/tenant-database';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, grantId, id, memberId, unitId } from './support/authz-fixtures';

const harness = new AuthzHarness();
const store = new MemberStore();
const ACTOR = memberId(1);

const inTenant = <T>(work: (tx: TenantTx) => Promise<T>, tenant = TENANT_A): Promise<T> => harness.tenants.withTenant(contextFor(tenant, ACTOR), work);

describe('MemberStore (members and invitations, ADM-006)', () => {
  beforeAll(async () => {
    await harness.start();
    for (const tenant of [TENANT_A, TENANT_B]) await harness.seedUnits(tenant, [{ n: 1, path: '/u1/' }, { n: 2, path: '/u1/u2/', parent: 1 }]);
    for (const member of [1, 2, 3]) await harness.seedMembership(TENANT_A, member, 1);
    await inTenant((tx) => seedSystemRoles(tx, ACTOR));
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  }, 60_000);

  const roleIdOf = async (code: string): Promise<string> => (await admin<{ id: string }>('select id from machvon.role_definition where tenant_id = $1 and code = $2', [TENANT_A, code]))[0]?.id ?? '';
  const makeOwner = async (n: number, member: number): Promise<void> => {
    await harness.owner(TENANT_A, [
      [
        `insert into machvon.role_grant (tenant_id, id, membership_id, role_id, scope_json, effective_from, scope_kind, scope_ref_ids, status, granted_by, grant_reason)
         values ($1, $2, $3, $4, '{"kind":"TENANT","ref_ids":[]}'::jsonb, '2026-01-01T00:00:00Z', 'TENANT', '{}', 'Active', $5, 'test')`,
        [TENANT_A, grantId(n), memberId(member), await roleIdOf('TENANT_OWNER'), ACTOR],
      ],
    ]);
  };

  const admin = async <R extends object>(text: string, params: unknown[] = []): Promise<R[]> => {
    const client = new Client({ connectionString: harness.database.adminUrl });
    await client.connect();
    try {
      return (await client.query(text, params)).rows as R[];
    } finally {
      await client.end();
    }
  };

  describe('the account of an invitation', () => {
    it('creates an unbound shell for a new email, named after the address when no name is given, and reuses it for the same address in any case', async () => {
      const first = await inTenant((tx) => store.ensureInvitedAccount(tx, '  New.Person@Example.TEST ', undefined));
      const again = await inTenant((tx) => store.ensureInvitedAccount(tx, 'new.person@example.test', 'Ignored Name'));
      expect(again).toBe(first);
      const [account] = await admin<{ idp_subject: string; display_name: string; email_normalized: string; status: string }>(
        'select idp_subject, display_name, email_normalized, status from machvon.user_account where id = $1',
        [first],
      );
      expect(account).toMatchObject({ display_name: 'new.person', email_normalized: 'new.person@example.test', status: 'Active' });
      expect(account?.idp_subject).toMatch(/^invitation:[0-9a-f-]{36}$/);
    });

    it('finds the account of a person who already has one', async () => {
      const found = await inTenant((tx) => store.ensureInvitedAccount(tx, 'user2@example.test', 'Another Name'));
      expect(found).toBe(id(0x60, 2));
    });

    it.each(['', '   ', 'no-at-sign', '@x', `${'a'.repeat(250)}@example.test`])('refuses the address %j', async (email) => {
      await expect(inTenant((tx) => store.ensureInvitedAccount(tx, email, undefined))).rejects.toMatchObject({ code: '22023' });
    });

    it('cannot be called by one tenant to read the accounts of another: it returns an id and nothing else', async () => {
      const id1 = await inTenant((tx) => store.ensureInvitedAccount(tx, 'shared@example.test', 'Shared'), TENANT_A);
      const id2 = await inTenant((tx) => store.ensureInvitedAccount(tx, 'shared@example.test', 'Shared'), TENANT_B);
      expect(id2).toBe(id1);
    });
  });

  describe('invited memberships and invitations', () => {
    it('refuses a second live membership of one person in one unit', async () => {
      const account = await inTenant((tx) => store.ensureInvitedAccount(tx, 'twice@example.test', undefined));
      const input = { userAccountId: account, organizationId: unitId(2), membershipType: 'STAFF' as const, invitedBy: ACTOR };
      await inTenant((tx) => store.insertInvitedMember(tx, input));
      await expect(inTenant((tx) => store.insertInvitedMember(tx, input))).rejects.toMatchObject({ code: 'MEMBERSHIP_EXISTS', status: 409 });
    });

    it('moves an invitation through acceptance and expiry, and finds nothing for a missing one', async () => {
      const account = await inTenant((tx) => store.ensureInvitedAccount(tx, 'flow@example.test', undefined));
      const member = await inTenant((tx) => store.insertInvitedMember(tx, { userAccountId: account, organizationId: unitId(2), membershipType: 'STAFF', invitedBy: ACTOR }));
      const invitation = await inTenant((tx) =>
        store.insertInvitation(tx, { membershipId: member.id, emailHash: 'a'.repeat(64), tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'), invitedBy: ACTOR, expiresAt: new Date(Date.now() + 60_000) }),
      );
      const found = await inTenant((tx) => store.findInvitation(tx, invitation.id, { forUpdate: true }));
      expect(found).toMatchObject({ id: invitation.id, membershipId: member.id, status: 'Pending', expired: false });
      expect(await inTenant((tx) => store.findInvitation(tx, randomUUID()))).toBeUndefined();

      await inTenant((tx) => store.markInvitationAccepted(tx, invitation.id));
      expect((await inTenant((tx) => store.findInvitation(tx, invitation.id)))?.status).toBe('Accepted');

      const second = await inTenant((tx) => store.insertInvitation(tx, { membershipId: member.id, emailHash: 'b'.repeat(64), tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '1'), invitedBy: ACTOR, expiresAt: new Date(Date.now() - 1000) }));
      expect((await inTenant((tx) => store.findInvitation(tx, second.id)))?.expired).toBe(true);
      await inTenant((tx) => store.expireInvitation(tx, second.id, member.id));
      expect((await inTenant((tx) => store.findInvitation(tx, second.id)))?.status).toBe('Expired');
      expect((await inTenant((tx) => store.membershipOf(tx, member.id)))?.status).toBe('Expired');
      expect(await inTenant((tx) => store.membershipOf(tx, randomUUID()))).toBeUndefined();
    });

    it('revokes the pending invitations of a membership and nothing else', async () => {
      const account = await inTenant((tx) => store.ensureInvitedAccount(tx, 'revoke@example.test', undefined));
      const member = await inTenant((tx) => store.insertInvitedMember(tx, { userAccountId: account, organizationId: unitId(2), membershipType: 'STAFF', invitedBy: ACTOR }));
      const pending = await inTenant((tx) => store.insertInvitation(tx, { membershipId: member.id, emailHash: 'c'.repeat(64), tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '2'), invitedBy: ACTOR, expiresAt: new Date(Date.now() + 60_000) }));
      await inTenant((tx) => store.revokePendingInvitations(tx, member.id));
      expect((await inTenant((tx) => store.findInvitation(tx, pending.id)))?.status).toBe('Revoked');
    });

    it('locks a member with the path of their unit, sets the status with a new version and ends their sessions once', async () => {
      const member = await inTenant((tx) => store.lockMember(tx, memberId(2)));
      expect(member).toMatchObject({ id: memberId(2), status: 'Active', unitPath: '/u1/', version: 1, membershipType: 'STAFF' });
      expect(await inTenant((tx) => store.lockMember(tx, randomUUID()))).toBeUndefined();
      expect(await inTenant((tx) => store.setStatus(tx, memberId(2), 'Suspended'))).toBe(2);
      expect(await inTenant((tx) => store.setStatus(tx, memberId(2), 'Ended', 'left the company'))).toBe(3);
      expect((await admin<{ ended_reason: string }>('select ended_reason from machvon.membership where id = $1', [memberId(2)]))[0]?.ended_reason).toBe('left the company');
      await admin(
        `insert into machvon.user_session (tenant_id, id, user_account_id, membership_id, idp_session_id, assurance_level, ip_hash, user_agent_summary)
         values ($1, $2, $3, $4, 'idp-store', 'aal1', $5, 'test')`,
        [TENANT_A, randomUUID(), id(0x60, 2), memberId(2), '0'.repeat(64)],
      );
      expect(await inTenant((tx) => store.revokeSessions(tx, memberId(2), 'MEMBERSHIP_CHANGED'))).toHaveLength(1);
      expect(await inTenant((tx) => store.revokeSessions(tx, memberId(2), 'MEMBERSHIP_CHANGED'))).toHaveLength(0);
    });

    it('finds an active role by code and none for an unknown one', async () => {
      expect(await inTenant((tx) => store.activeRoleByCode(tx, 'MEMBER'))).toEqual({ id: await roleIdOf('MEMBER') });
      expect(await inTenant((tx) => store.activeRoleByCode(tx, 'NO_SUCH_ROLE'))).toBeUndefined();
    });
  });

  describe('owners', () => {
    it('knows the last owner: only an Active owner with no Active owner beside them is last', async () => {
      await makeOwner(1, 1);
      expect(await inTenant((tx) => store.isLastOwner(tx, memberId(1)))).toBe(true);
      expect(await inTenant((tx) => store.isLastOwner(tx, memberId(3)))).toBe(false);
      await makeOwner(2, 3);
      expect(await inTenant((tx) => store.isLastOwner(tx, memberId(1)))).toBe(false);
      expect(await inTenant((tx) => store.isLastOwner(tx, memberId(3)))).toBe(false);
      await admin("update machvon.membership set status = 'Suspended' where id = $1", [memberId(3)]);
      expect(await inTenant((tx) => store.isLastOwner(tx, memberId(1)))).toBe(true);
      expect(await inTenant((tx) => store.grantRoleCodes(tx, memberId(1)))).toEqual(['TENANT_OWNER']);
    });
  });

  describe('seats', () => {
    const revision = async (seats: number | null, quota: Record<string, unknown>, status = 'Active', from = "now() - interval '1 day'"): Promise<void> => {
      const client = new Client({ connectionString: harness.database.adminUrl });
      await client.connect();
      try {
        await client.query('set session_replication_role = replica');
        await client.query(
          `insert into machvon.license_revision (tenant_id, id, serial, revision, entitlement_version_id, valid_from, valid_until, grace_until, status, signed_claims, key_id, seats, quota_json)
           values ($1, $2, $3, 1, $4, ${from}, now() + interval '1 year', now() + interval '2 years', $5, 'claims', 'key', $6, $7::jsonb)`,
          [TENANT_A, randomUUID(), randomUUID(), randomUUID(), status, seats, JSON.stringify(quota)],
        );
      } finally {
        await client.end();
      }
    };

    it('has no limit when the tenant has no licence', async () => {
      expect(await inTenant((tx) => store.seatLimits(tx))).toEqual({ seats: null, guestSeats: null });
      await inTenant((tx) => store.assertSeatFree(tx, 'STAFF'));
    });

    it('reads the seats and the guest seats of the latest valid revision, and ignores revoked, future and malformed ones', async () => {
      await revision(5, { guest_seats: 'many' }, 'Revoked');
      await revision(6, {}, 'Active', "now() + interval '1 day'");
      expect(await inTenant((tx) => store.seatLimits(tx))).toEqual({ seats: null, guestSeats: null });
      await revision(4, { guest_seats: 'many' });
      expect(await inTenant((tx) => store.seatLimits(tx))).toEqual({ seats: 4, guestSeats: null });
      await revision(3, { guest_seats: 2 }, 'Issued', "now() - interval '1 hour'");
      expect(await inTenant((tx) => store.seatLimits(tx))).toEqual({ seats: 3, guestSeats: 2 });
    });

    it('counts staff and guests apart and refuses the seat that passes the limit', async () => {
      const used = await inTenant((tx) => store.seatsInUse(tx));
      expect(used.guests).toBe(0);
      expect(used.staff).toBeGreaterThanOrEqual(1);
      await expect(inTenant((tx) => store.assertSeatFree(tx, 'STAFF'))).resolves.toBeUndefined();
      await admin("update machvon.license_revision set seats = $1 where tenant_id = $2 and status = 'Issued'", [used.staff, TENANT_A]);
      await expect(inTenant((tx) => store.assertSeatFree(tx, 'STAFF'))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', status: 403 });
      await admin("update machvon.license_revision set quota_json = '{\"guest_seats\": 0}'::jsonb where tenant_id = $1 and status = 'Issued'", [TENANT_A]);
      await expect(inTenant((tx) => store.assertSeatFree(tx, 'GUEST_CONTRACTOR'))).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    });
  });
});
