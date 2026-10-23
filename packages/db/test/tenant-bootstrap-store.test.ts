import { resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { ControlDatabase } from '../src/control-database';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { MemberStore } from '../src/member-store';
import { SYSTEM_ROLES, seedSystemRoles } from '../src/system-roles';
import { TenantBootstrapStore } from '../src/tenant-bootstrap-store';
import { TenantRegistry } from '../src/tenant-registry';
import type { TenantTx } from '../src/tenant-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PLACEMENT = '00000000-0000-4000-8000-0000000000b8';
const PLAN = '00000000-0000-4000-9000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000c9';
const NOW = new Date('2026-10-23T03:00:00Z');
const EXPIRES = new Date('2026-10-30T03:00:00Z');
const HASH = (n: number): string => n.toString(16).padStart(64, '0');
let counter = 0;
let hashes = 0;
/** Token hashes are unique across the table: each invitation of the tests takes the next one. */
const nextHash = (): number => {
  hashes += 1;
  return hashes;
};

describe('the tenant rows provisioning writes from the control plane', () => {
  let database: TestDatabase;
  let controlPool: Pool;
  let control: ControlDatabase;
  let registry: TenantRegistry;
  const store = new TenantBootstrapStore();

  async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: database.adminUrl });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  async function seedTenant(status = 'Provisioning'): Promise<string> {
    counter += 1;
    const tenantId = `00000000-0000-4000-8000-${(0xf000 + counter).toString(16).padStart(12, '0')}`;
    await asAdmin((client) => client.query("insert into machvon.tenant (id, code, name, status, placement_id, region) values ($1, $2, $2, $3, $4, 'vn-north')", [tenantId, `bootstrap-${counter}`, status, PLACEMENT]));
    return tenantId;
  }

  const inTenant = <T>(tenantId: string, work: (tx: TenantTx) => Promise<T>): Promise<T> => control.withTenantOf(tenantId, work);

  async function readyTenant(): Promise<{ tenantId: string; unitId: string }> {
    const tenantId = await seedTenant();
    await inTenant(tenantId, (tx) => seedSystemRoles(tx, ACTOR));
    const root = await inTenant(tenantId, (tx) => store.ensureRootUnit(tx, `00000000-0000-4000-8000-${(0xe000 + counter).toString(16).padStart(12, '0')}`, 'Ủy ban nhân dân', NOW));
    return { tenantId, unitId: root.id };
  }

  const assign = (tenantId: string, email: string) => {
    const n = nextHash();
    return inTenant(tenantId, (tx) => store.assignOwner(tx, { email, assignedBy: ACTOR, tokenHash: HASH(n), emailHash: HASH(n + 100_000), expiresAt: EXPIRES }));
  };

  // As machvon_owner: row-level security applies to it, so the rows are the tenant's own (a superuser would see every tenant's).
  const rows = async <T extends object>(tenantId: string, text: string, params: unknown[] = []): Promise<T[]> => {
    const client = new Client({ connectionString: database.urlFor('machvon_owner') });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await client.query<T>(text, params);
      await client.query('commit');
      return result.rows;
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    controlPool = new Pool({ connectionString: database.urlFor('machvon_control'), max: 4 });
    controlPool.on('error', () => undefined);
    control = new ControlDatabase(controlPool);
    registry = new TenantRegistry(control, { now: () => NOW });
    await asAdmin((client) => client.query("insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status) values ($1, 'POOL', 'vn-north', 'north-8', 'kms-8', 'Active')", [PLACEMENT]));
  }, 180_000);

  afterAll(async () => {
    await controlPool?.end();
    if (database) await database.stop();
  }, 60_000);

  describe('roles, plan, subscription and root unit', () => {
    it('lets the control role seed the system roles of a tenant, once', async () => {
      const tenantId = await seedTenant();
      expect(await inTenant(tenantId, (tx) => seedSystemRoles(tx, ACTOR))).toEqual({ inserted: SYSTEM_ROLES.length });
      expect(await inTenant(tenantId, (tx) => seedSystemRoles(tx, ACTOR))).toEqual({ inserted: 0 });
      expect(await rows(tenantId, 'select count(*)::int as n from machvon.role_definition')).toEqual([{ n: SYSTEM_ROLES.length }]);
    });

    it('reads the features of a plan version as entitlement entries', async () => {
      const tenantId = await seedTenant();
      const features = await inTenant(tenantId, (tx) => store.planFeatures(tx, PLAN));
      expect(features.map((feature) => feature.featureCode)).toEqual(['ai.analysis', 'export', 'member.invite', 'member.seats', 'notification.campaign', 'reporting']);
      expect(features.find((feature) => feature.featureCode === 'member.seats')).toEqual({ featureCode: 'member.seats', limitKind: 'QUOTA', limitValue: 50, graceBehavior: 'READ_ONLY', expiredBehavior: 'DENY' });
      expect(features.find((feature) => feature.featureCode === 'reporting')).toEqual({ featureCode: 'reporting', limitKind: 'BOOLEAN', graceBehavior: 'ALLOW', expiredBehavior: 'READ_ONLY' });
      expect(await inTenant(tenantId, (tx) => store.planFeatures(tx, '00000000-0000-4000-9000-0000000000ff'))).toEqual([]);
    });

    it('starts a tenant on one Trialing subscription and returns the same one the second time', async () => {
      const tenantId = await seedTenant();
      const first = await inTenant(tenantId, (tx) => store.ensureTrialSubscription(tx, PLAN, NOW));
      const second = await inTenant(tenantId, (tx) => store.ensureTrialSubscription(tx, PLAN, NOW));
      expect(second).toBe(first);
      expect(await rows(tenantId, 'select status, plan_version_id, billing_anchor::text as anchor from machvon.subscription')).toEqual([{ status: 'Trialing', plan_version_id: PLAN, anchor: '2026-10-23' }]);
    });

    it('creates the root unit as a governing body at depth 0 and leaves an existing one alone', async () => {
      const tenantId = await seedTenant();
      const unitId = '00000000-0000-4000-8000-0000000000d1';
      expect(await inTenant(tenantId, (tx) => store.rootUnitId(tx))).toBeUndefined();
      expect(await inTenant(tenantId, (tx) => store.ensureRootUnit(tx, unitId, 'Root name', NOW))).toEqual({ id: unitId, created: true });
      expect(await inTenant(tenantId, (tx) => store.ensureRootUnit(tx, '00000000-0000-4000-8000-0000000000d2', 'Other name', NOW))).toEqual({ id: unitId, created: false });
      expect(await rows(tenantId, 'select code, name, unit_type, depth, path, parent_id, status from machvon.organization_unit')).toEqual([
        { code: 'ROOT', name: 'Root name', unit_type: 'GOVERNING_BODY', depth: 0, path: `/${unitId}/`, parent_id: null, status: 'Active' },
      ]);
    });
  });

  describe('naming an owner', () => {
    it('invites the person into the root unit with the TENANT_OWNER grant and one pending invitation', async () => {
      const { tenantId, unitId } = await readyTenant();
      const owner = await assign(tenantId, 'Owner@Example.org');
      expect(owner).toMatchObject({ unitId, superseded: [] });
      expect(owner.invitationId).toBeDefined();
      expect(await rows(tenantId, 'select status, organization_id, membership_type from machvon.membership')).toEqual([{ status: 'Invited', organization_id: unitId, membership_type: 'STAFF' }]);
      expect(await rows(tenantId, "select r.code, g.status, g.scope_kind from machvon.role_grant g join machvon.role_definition r on r.id = g.role_id")).toEqual([{ code: 'TENANT_OWNER', status: 'Active', scope_kind: 'TENANT' }]);
      expect(await rows(tenantId, 'select status, token_hash from machvon.membership_invitation')).toEqual([{ status: 'Pending', token_hash: expect.stringMatching(/^0+[0-9a-f]+$/) as unknown as string }]);
    });

    it('sends the invitation again for the same person: the earlier one is revoked, one is pending, nothing else is duplicated', async () => {
      const { tenantId } = await readyTenant();
      const first = await assign(tenantId, 'owner@example.org');
      const second = await assign(tenantId, 'owner@example.org');
      expect(second.membershipId).toBe(first.membershipId);
      expect(second.invitationId).not.toBe(first.invitationId);
      expect(await rows(tenantId, 'select status from machvon.membership_invitation order by status')).toEqual([{ status: 'Pending' }, { status: 'Revoked' }]);
      expect(await rows(tenantId, 'select count(*)::int as n from machvon.role_grant')).toEqual([{ n: 1 }]);
      expect(await rows(tenantId, 'select count(*)::int as n from machvon.membership')).toEqual([{ n: 1 }]);
    });

    it('revokes the pending owner invitation of someone else when another person is named', async () => {
      const { tenantId } = await readyTenant();
      const first = await assign(tenantId, 'first@example.org');
      const second = await assign(tenantId, 'second@example.org');
      expect(second.superseded).toEqual([first.membershipId]);
      expect(await rows(tenantId, 'select m.id, m.status, m.ended_reason from machvon.membership m order by m.created_at')).toEqual([
        { id: first.membershipId, status: 'Ended', ended_reason: 'OWNER_REPLACED' },
        { id: second.membershipId, status: 'Invited', ended_reason: null },
      ]);
      expect(await rows(tenantId, "select membership_id, status from machvon.membership_invitation where status = 'Pending'")).toEqual([{ membership_id: second.membershipId, status: 'Pending' }]);
      expect(await rows(tenantId, "select membership_id from machvon.role_grant where status = 'Active'")).toEqual([{ membership_id: second.membershipId }]);
    });

    it('never touches an owner who already accepted when another person is named', async () => {
      const { tenantId } = await readyTenant();
      const first = await assign(tenantId, 'first@example.org');
      await asAdmin(async (client) => {
        await client.query('begin');
        await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        await client.query("update machvon.membership set status = 'Active' where id = $1", [first.membershipId]);
        await client.query('commit');
      });
      const second = await assign(tenantId, 'second@example.org');
      expect(second.superseded).toEqual([]);
      expect(await rows(tenantId, "select count(*)::int as n from machvon.role_grant where status = 'Active'")).toEqual([{ n: 2 }]);
    });

    it('refuses a person who already owns the tenant, one whose membership is suspended, and a tenant that has no root unit or no roles yet', async () => {
      const { tenantId } = await readyTenant();
      const owner = await assign(tenantId, 'owner@example.org');
      const setStatus = (status: string): Promise<unknown> =>
        asAdmin(async (client) => {
          await client.query('begin');
          await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
          await client.query('update machvon.membership set status = $2 where id = $1', [owner.membershipId, status]);
          await client.query('commit');
        });
      await setStatus('Active');
      await expect(assign(tenantId, 'owner@example.org')).rejects.toMatchObject({ code: 'MEMBERSHIP_STATE_INVALID', status: 409 });
      await setStatus('Suspended');
      await expect(assign(tenantId, 'owner@example.org')).rejects.toMatchObject({ code: 'MEMBERSHIP_STATE_INVALID', status: 409 });
      const bare = await seedTenant();
      await expect(assign(bare, 'owner@example.org')).rejects.toMatchObject({ code: 'MEMBERSHIP_STATE_INVALID', status: 409 });
    });

    it('grants the role to a person who is an active member of the root unit without sending an invitation', async () => {
      const { tenantId } = await readyTenant();
      const first = await assign(tenantId, 'member@example.org');
      await asAdmin(async (client) => {
        await client.query('begin');
        await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        await client.query("update machvon.membership set status = 'Active' where id = $1", [first.membershipId]);
        await client.query("update machvon.role_grant set status = 'Revoked', revoked_at = now(), revoked_by = $1, revoke_reason = 'test' where membership_id = $2", [ACTOR, first.membershipId]);
        await client.query('commit');
      });
      const again = await assign(tenantId, 'member@example.org');
      expect(again).toMatchObject({ membershipId: first.membershipId, invitationId: undefined });
      expect(again.grantId).toBeDefined();
      expect(await rows(tenantId, "select count(*)::int as n from machvon.membership_invitation")).toEqual([{ n: 1 }]);
    });

    it('raises the authorization version of an active member who receives the grant, and reports the version the membership really has', async () => {
      const { tenantId } = await readyTenant();
      const first = await assign(tenantId, 'member@example.org');
      expect(first.membershipVersion).toBe(1);
      await asAdmin(async (client) => {
        await client.query('begin');
        await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        // Accepting the invitation raised the version before; the grant is gone, so the person is only a member.
        await client.query("update machvon.membership set status = 'Active', version = 4 where id = $1", [first.membershipId]);
        await client.query("update machvon.role_grant set status = 'Revoked', revoked_at = now(), revoked_by = $1, revoke_reason = 'test' where membership_id = $2", [ACTOR, first.membershipId]);
        await client.query('commit');
      });
      const before = await rows<{ scope_version: string }>(tenantId, 'select scope_version::text as scope_version from machvon.membership where id = $1', [first.membershipId]);
      const again = await assign(tenantId, 'member@example.org');
      expect(again.membershipVersion).toBe(4);
      const after = await rows<{ scope_version: string }>(tenantId, 'select scope_version::text as scope_version from machvon.membership where id = $1', [first.membershipId]);
      expect(Number(after[0]?.scope_version)).toBe(Number(before[0]?.scope_version) + 1);
    });

    it('refuses to make a guest contractor the owner, whether the guest is invited or active', async () => {
      const { tenantId, unitId } = await readyTenant();
      const email = 'guest@example.org';
      const userId = await inTenant(tenantId, (tx) => new MemberStore().ensureInvitedAccount(tx, email, 'Guest'));
      await asAdmin(async (client) => {
        await client.query('set session_replication_role = replica');
        await client.query('begin');
        await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        await client.query(
          `insert into machvon.membership (tenant_id, id, user_id, organization_id, status, membership_type, contractor_id, valid_until)
           values ($1, '00000000-0000-4000-8000-00000000aa01', $2, $3, 'Active', 'GUEST_CONTRACTOR', '00000000-0000-4000-8000-00000000aa02', now() + interval '30 days')`,
          [tenantId, userId, unitId],
        );
        await client.query('commit');
      });
      await expect(assign(tenantId, email)).rejects.toMatchObject({ code: 'MEMBERSHIP_STATE_INVALID', status: 409 });
      expect(await rows(tenantId, "select count(*)::int as n from machvon.role_grant g join machvon.role_definition r on r.id = g.role_id where r.code = 'TENANT_OWNER'")).toEqual([{ n: 0 }]);
    });

    it('lets only one of two concurrent assignments to different people stay pending', async () => {
      const { tenantId } = await readyTenant();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolveGate) => {
        release = resolveGate;
      });
      let enteredFirst: () => void = () => undefined;
      const first = new Promise<void>((resolveFirst) => {
        enteredFirst = resolveFirst;
      });
      const holder = inTenant(tenantId, async (tx) => {
        const n = nextHash();
        const result = await store.assignOwner(tx, { email: 'one@example.org', assignedBy: ACTOR, tokenHash: HASH(n), emailHash: HASH(n + 100_000), expiresAt: EXPIRES });
        enteredFirst();
        await gate;
        return result;
      });
      await first;
      const second = assign(tenantId, 'two@example.org');
      // The second assignment has to wait for the first one to commit; give it the chance to (wrongly) finish before that.
      const early = await Promise.race([second.then(() => 'finished'), new Promise<string>((resolveWait) => setTimeout(() => resolveWait('waiting'), 700))]);
      expect(early).toBe('waiting');
      release();
      const [one, two] = await Promise.all([holder, second]);
      expect(two.superseded).toEqual([one.membershipId]);
      expect(await rows(tenantId, "select membership_id from machvon.membership_invitation where status = 'Pending'")).toEqual([{ membership_id: two.membershipId }]);
      expect(await rows(tenantId, "select membership_id from machvon.role_grant where status = 'Active'")).toEqual([{ membership_id: two.membershipId }]);
    });

    it('revokes every pending owner when provisioning is cancelled, and reports how many', async () => {
      const { tenantId } = await readyTenant();
      await assign(tenantId, 'owner@example.org');
      expect(await inTenant(tenantId, (tx) => store.revokePendingOwners(tx, ACTOR))).toBe(1);
      expect(await inTenant(tenantId, (tx) => store.revokePendingOwners(tx, ACTOR))).toBe(0);
      expect(await rows(tenantId, 'select status from machvon.membership_invitation')).toEqual([{ status: 'Revoked' }]);
      expect(await rows(tenantId, 'select status, ended_reason from machvon.membership')).toEqual([{ status: 'Ended', ended_reason: 'PROVISIONING_CANCELLED' }]);
      const bare = await seedTenant();
      expect(await inTenant(bare, (tx) => store.revokePendingOwners(tx, ACTOR))).toBe(0);
    });
  });

  describe('what the database allows the control role', () => {
    it('lets it change only the state columns of a membership, an invitation and a grant, and never delete', async () => {
      const { tenantId } = await readyTenant();
      const owner = await assign(tenantId, 'owner@example.org');
      const attempt = (sql: string, params: unknown[]): Promise<unknown> => inTenant(tenantId, (tx) => tx.query(sql, params));
      await expect(attempt('update machvon.membership set organization_id = organization_id where id = $1', [owner.membershipId])).rejects.toThrow('permission denied');
      await expect(attempt("update machvon.membership_invitation set token_hash = repeat('f', 64)", [])).rejects.toThrow('permission denied');
      await expect(attempt("update machvon.role_grant set role_id = role_id", [])).rejects.toThrow('permission denied');
      await expect(attempt('delete from machvon.membership where id = $1', [owner.membershipId])).rejects.toThrow('permission denied');
      await expect(attempt('delete from machvon.role_grant', [])).rejects.toThrow('permission denied');
    });

    it('shows a tenant the rows of its own only', async () => {
      const a = await readyTenant();
      const b = await readyTenant();
      await assign(a.tenantId, 'a@example.org');
      expect(await inTenant(b.tenantId, (tx) => tx.query('select id from machvon.membership'))).toEqual([]);
    });
  });

  describe('finishing a run', () => {
    async function runningTenant(status = 'Provisioning'): Promise<{ tenantId: string; runId: string }> {
      const tenantId = await seedTenant(status);
      const runId = await inTenant(tenantId, async (tx) => {
        const created = await tx.query<{ id: string }>(
          "insert into machvon.tenant_provisioning_run (tenant_id, id, attempt, temporal_workflow_id, status, current_step, steps_json, requested_by) values ($1::uuid, gen_random_uuid(), 1, 'w', 'Running', 'OWNER_INVITE', '{}'::jsonb, $2::uuid) returning id",
          [tenantId, ACTOR],
        );
        return created[0]?.id ?? '';
      });
      return { tenantId, runId };
    }

    it('moves the tenant to Active and the run to Succeeded together, and runs the hook once', async () => {
      const { tenantId, runId } = await runningTenant();
      const seen: string[] = [];
      await registry.completeRun(tenantId, runId, (tx) => Promise.resolve(void seen.push(String(tx !== undefined))));
      expect(await asAdmin((client) => client.query("select status, activated_at is not null as activated, version::text as version from machvon.tenant where id = $1", [tenantId]).then((r) => r.rows))).toEqual([{ status: 'Active', activated: true, version: '2' }]);
      expect(await rows(tenantId, 'select status, finished_at is not null as finished from machvon.tenant_provisioning_run')).toEqual([{ status: 'Succeeded', finished: true }]);
      await registry.completeRun(tenantId, runId, (tx) => Promise.resolve(void seen.push(String(tx !== undefined))));
      expect(seen).toEqual(['true']);
    });

    it('leaves the tenant Provisioning when the run named is not the running attempt', async () => {
      const { tenantId, runId } = await runningTenant();
      const hook = jest.fn(() => Promise.resolve());
      // A stale attempt that failed while a retry run is the one running, and a run that does not exist.
      await asAdmin((client) => client.query("update machvon.tenant_provisioning_run set status = 'Failed', error_code = 'X' where id = $1", [runId]));
      await expect(registry.completeRun(tenantId, runId, hook)).rejects.toMatchObject({ code: 'TENANT_STATE_INVALID', status: 409 });
      await expect(registry.completeRun(tenantId, '00000000-0000-4000-8000-0000000fffee', hook)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
      expect((await registry.getTenant(tenantId))?.status).toBe('Provisioning');
      expect(hook).not.toHaveBeenCalled();
    });

    it('rolls the move back when the hook fails, and refuses a tenant that is not Provisioning or Active', async () => {
      const { tenantId, runId } = await runningTenant();
      await expect(registry.completeRun(tenantId, runId, () => Promise.reject(new Error('audit failed')))).rejects.toThrow('audit failed');
      expect((await registry.getTenant(tenantId))?.status).toBe('Provisioning');
      const failed = await runningTenant('Failed');
      await expect(registry.completeRun(failed.tenantId, failed.runId)).rejects.toMatchObject({ code: 'TENANT_STATE_INVALID', status: 409 });
      await expect(registry.completeRun('00000000-0000-4000-8000-0000000fffff', failed.runId)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });
  });
});
