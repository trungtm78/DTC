import { randomUUID } from 'node:crypto';
import type { SecurityPolicyContent } from '@machvon/kernel';
import { SecurityPolicyStore } from '../src/security-policy-store';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, memberId, unitId } from './support/authz-fixtures';

const AUTHOR = memberId(1);
const APPROVER = memberId(2);
const path = (...ns: number[]): string => `/${ns.map(unitId).join('/')}/`;
const POLICY: SecurityPolicyContent = { mfa_required_roles: ['LEADER'], session_idle_minutes: 30, session_max_hours: 8 };

describe('SecurityPolicyStore (ST-ADM-009)', () => {
  const harness = new AuthzHarness();
  const store = new SecurityPolicyStore();
  const ctxA = contextFor(TENANT_A, AUTHOR);
  const ctxB = contextFor(TENANT_B, AUTHOR);
  const asA = <T>(work: Parameters<typeof harness.tenants.withTenant<T>>[1]): Promise<T> => harness.tenants.withTenant(ctxA, work);
  const asB = <T>(work: Parameters<typeof harness.tenants.withTenant<T>>[1]): Promise<T> => harness.tenants.withTenant(ctxB, work);

  const draft = (content: SecurityPolicyContent = POLICY): Promise<{ id: string; revision: number; version: number }> => asA((tx) => store.createDraft(tx, content, AUTHOR));
  const publish = (id: string, approver = APPROVER): Promise<{ version: number; supersededId: string | undefined }> =>
    asA(async (tx) => store.publish(tx, await store.lockDraft(tx, id, 1), approver));

  beforeAll(async () => {
    await harness.start();
    for (const tenant of [TENANT_A, TENANT_B]) {
      await harness.seedUnits(tenant, [{ n: 1, path: path(1) }]);
      await harness.seedMembership(tenant, 1, 1);
      await harness.seedMembership(tenant, 2, 1);
    }
    await harness.seedRole(TENANT_A, 1, 'LEADER', [], 10);
    await harness.seedRole(TENANT_A, 2, 'AUDITOR', [], 10);
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  }, 60_000);

  afterEach(async () => {
    await harness.owner(TENANT_A, [['delete from machvon.security_policy_version', []]]);
    await harness.owner(TENANT_B, [['delete from machvon.security_policy_version', []]]);
  });

  it('numbers drafts 1, 2, 3 without gaps, even when created in parallel', async () => {
    const created = await Promise.all([draft(), draft(), draft()]);
    expect(created.map((row) => row.revision).sort()).toEqual([1, 2, 3]);
    expect((await draft()).revision).toBe(4);
  });

  it('stores a draft as Draft at version 1 and never counts it as the active policy', async () => {
    const { id } = await draft();
    expect(await asA((tx) => store.find(tx, id))).toMatchObject({ status: 'Draft', version: 1, content: POLICY, createdBy: AUTHOR, approvedBy: null, publishedAt: null });
    expect(await asA((tx) => store.active(tx))).toBeUndefined();
  });

  it('refuses four-eyes violations: the author may not publish their own draft', async () => {
    const { id } = await draft();
    await expect(publish(id, AUTHOR)).rejects.toMatchObject({ code: 'SELF_APPROVAL_DENIED', status: 403 });
    expect((await asA((tx) => store.find(tx, id)))?.status).toBe('Draft');
  });

  it('publishes a draft for another approver, with the approver and the time, and makes it the active policy', async () => {
    const { id } = await draft();
    expect((await publish(id)).version).toBe(2);
    const row = await asA((tx) => store.find(tx, id));
    expect(row).toMatchObject({ status: 'Published', approvedBy: APPROVER, version: 2 });
    expect(row?.publishedAt).not.toBeNull();
    expect((await asA((tx) => store.active(tx)))?.id).toBe(id);
  });

  it('supersedes the version in force when the next one is published, so only one is ever Published', async () => {
    const first = await draft();
    await publish(first.id);
    const second = await draft({ ...POLICY, session_max_hours: 4 });
    expect((await publish(second.id)).supersededId).toBe(first.id);
    expect((await asA((tx) => store.find(tx, first.id)))?.status).toBe('Superseded');
    expect((await asA((tx) => store.active(tx)))?.id).toBe(second.id);
    expect((await harness.owner<{ n: string }>(TENANT_A, [["select count(*) as n from machvon.security_policy_version where status = 'Published'", []]]))[0]?.n).toBe('1');
  });

  it('answers 404 for a missing policy, 409 for one already published and 409 VERSION_CONFLICT for a stale version', async () => {
    await expect(asA((tx) => store.lockDraft(tx, randomUUID(), 1))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    const { id } = await draft();
    await expect(asA((tx) => store.lockDraft(tx, id, 9))).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    await publish(id);
    await expect(asA((tx) => store.lockDraft(tx, id, 2))).rejects.toMatchObject({ code: 'STAGE_TRANSITION_DENIED', status: 409 });
  });

  it('lists the newest revision first and pages by revision', async () => {
    const ids: string[] = [];
    for (let n = 0; n < 4; n += 1) ids.push((await draft()).id);
    const first = await asA((tx) => store.list(tx, { limit: 3, after: undefined }));
    expect(first.map((row) => row.id)).toEqual([ids[3], ids[2], ids[1]]);
    const last = first[2] as { revision: number; id: string };
    expect((await asA((tx) => store.list(tx, { limit: 3, after: { code: String(last.revision), id: last.id } }))).map((row) => row.id)).toEqual([ids[0]]);
    await expect(asA((tx) => store.list(tx, { limit: 3, after: { code: 'x', id: randomUUID() } }))).rejects.toMatchObject({ code: 'VALIDATION_FAILED', detail: 'cursor' });
  });

  it('keeps tenants apart', async () => {
    const { id } = await draft();
    expect(await asB((tx) => store.find(tx, id))).toBeUndefined();
    expect(await asB((tx) => store.list(tx, { limit: 10, after: undefined }))).toEqual([]);
    await expect(asB((tx) => store.lockDraft(tx, id, 1))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect((await asB((tx) => store.createDraft(tx, POLICY, AUTHOR))).revision).toBe(1);
  });

  it('lists the codes of the active roles of the tenant only', async () => {
    expect([...(await asA((tx) => store.roleCodes(tx)))].filter((code) => ['LEADER', 'AUDITOR'].includes(code)).sort()).toEqual(['AUDITOR', 'LEADER']);
    expect((await asB((tx) => store.roleCodes(tx))).has('AUDITOR')).toBe(false);
  });

  describe('database guards', () => {
    it('keeps a published version immutable: content, revision and author cannot change, even for the owner role', async () => {
      const { id } = await draft();
      await publish(id);
      for (const [sql, params] of [
        ["update machvon.security_policy_version set policy_json = '{}'::jsonb where id = $1", [id]],
        ['update machvon.security_policy_version set revision = revision + 10 where id = $1', [id]],
        ['update machvon.security_policy_version set created_by = $2 where id = $1', [id, APPROVER]],
      ] as Array<[string, unknown[]]>) {
        await expect(harness.owner(TENANT_A, [[sql, params]])).rejects.toMatchObject({ code: '23514' });
      }
    });

    it('lets a Published version only become Superseded, and a Superseded one never change again', async () => {
      const { id } = await draft();
      await publish(id);
      await expect(harness.owner(TENANT_A, [["update machvon.security_policy_version set status = 'Draft' where id = $1", [id]]])).rejects.toMatchObject({ code: '23514' });
      await harness.owner(TENANT_A, [["update machvon.security_policy_version set status = 'Superseded' where id = $1", [id]]]);
      await expect(harness.owner(TENANT_A, [["update machvon.security_policy_version set status = 'Published' where id = $1", [id]]])).rejects.toMatchObject({ code: '23514' });
    });

    it('never lets a draft be superseded or published without an approver', async () => {
      const { id } = await draft();
      await expect(harness.owner(TENANT_A, [["update machvon.security_policy_version set status = 'Superseded' where id = $1", [id]]])).rejects.toMatchObject({ code: '23514' });
      await expect(harness.owner(TENANT_A, [["update machvon.security_policy_version set status = 'Published' where id = $1", [id]]])).rejects.toMatchObject({ code: '23514' });
    });

    it('refuses a second Published version in a tenant', async () => {
      const first = await draft();
      const second = await draft();
      await publish(first.id);
      await expect(
        harness.owner(TENANT_A, [["update machvon.security_policy_version set status = 'Published', approved_by = $2, published_at = now() where id = $1", [second.id, APPROVER]]]),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
