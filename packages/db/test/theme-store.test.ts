import { resolve } from 'node:path';
import { DomainError } from '@machvon/kernel';
import { Client, Pool } from 'pg';
import { ControlDatabase, PLATFORM_TENANT_ID } from '../src/control-database';
import { startMigratedTestDatabase } from '../src/migrated-test-database';
import { REVIEW_LIFETIME_MS, ThemeStore, themeChanges, themeHash } from '../src/theme-store';
import type { ThemeConfig } from '../src/theme-store';
import { TenantDatabase } from '../src/tenant-database';
import type { TestDatabase } from '../src/test-database';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PLACEMENT = '00000000-0000-4000-8000-0000000000d8';
const ADMIN_A = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_B = '00000000-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-10-23T03:00:00Z');
const REASON = 'The new colours failed the accessibility audit.';
let counter = 0;

const THEME_V1: ThemeConfig = { name: 'Agency', title: 'Agency portal', header: 'Agency', primary: '#0b5cad', primaryText: '#ffffff' };
const themeWith = (patch: ThemeConfig): ThemeConfig => ({ ...THEME_V1, ...patch });

async function failureOf(work: Promise<unknown>): Promise<DomainError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

describe('themeHash and themeChanges', () => {
  it('hashes the same content to the same value whatever the key order', () => {
    expect(themeHash({ a: '1', b: '2' })).toBe(themeHash({ b: '2', a: '1' }));
    expect(themeHash({ a: '1' })).toMatch(/^[a-f0-9]{64}$/);
    expect(themeHash({ a: '1' })).not.toBe(themeHash({ a: '2' }));
  });

  it('lists the fields that differ, treating a missing field as null', () => {
    expect(themeChanges({ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' })).toEqual([
      { field: 'b', before: '2', after: '9' },
      { field: 'c', before: '3', after: null },
      { field: 'd', before: null, after: '4' },
    ]);
    expect(themeChanges({ a: '1' }, { a: '1' })).toEqual([]);
  });
});

describe('tenant themes in the control plane (ST-SAS-005)', () => {
  let database: TestDatabase;
  let controlPool: Pool;
  let appPool: Pool;
  let control: ControlDatabase;
  let tenants: TenantDatabase;
  const store = new ThemeStore();

  async function asAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: database.adminUrl });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  /** Runs `work` the way a control command does: in a control transaction that acts as the tenant of the theme. */
  const inControl = <T>(tenantId: string, work: (tx: Parameters<ThemeStore['actingAs']>[0]) => Promise<T>): Promise<T> =>
    control.withTenantOf(PLATFORM_TENANT_ID, (tx) => store.actingAs(tx, tenantId, PLATFORM_TENANT_ID, () => work(tx)));

  async function seedTenant(withTheme = true): Promise<string> {
    counter += 1;
    const tenantId = `00000000-0000-4000-8000-${(0xf000 + counter).toString(16).padStart(12, '0')}`;
    await asAdmin((client) =>
      client.query("insert into machvon.tenant (id, code, name, status, placement_id, region) values ($1, $2, $2, 'Active', $3, 'vn-north')", [tenantId, `theme-${counter}`, PLACEMENT]),
    );
    if (withTheme) await inControl(tenantId, (tx) => store.createInitialVersion(tx, { tenantId, config: THEME_V1, publishedBy: ADMIN_A }));
    return tenantId;
  }

  const review = (tenantId: string, actorId = ADMIN_A, baseVersion = 1, now = NOW): Promise<Awaited<ReturnType<ThemeStore['createReview']>>> =>
    inControl(tenantId, async (tx) => {
      const draft = await store.getDraft(tx, tenantId);
      return store.createReview(tx, { tenantId, actorId, baseVersion, draftRevision: draft.revision, now });
    });

  const publish = (tenantId: string, token: string, actorId = ADMIN_A, baseVersion = 1, now = NOW): Promise<Awaited<ReturnType<ThemeStore['publish']>>> =>
    inControl(tenantId, (tx) => store.publish(tx, { tenantId, actorId, token, baseVersion, now }));

  const saveDraft = (tenantId: string, config: ThemeConfig, expectedRevision: number, actorId = ADMIN_A): Promise<Awaited<ReturnType<ThemeStore['saveDraft']>>> =>
    inControl(tenantId, (tx) => store.saveDraft(tx, { tenantId, config, expectedRevision, actorId }));

  beforeAll(async () => {
    database = await startMigratedTestDatabase(REPO_ROOT);
    controlPool = new Pool({ connectionString: database.urlFor('machvon_control'), max: 6 });
    controlPool.on('error', () => undefined);
    appPool = new Pool({ connectionString: database.urlFor('machvon_app'), max: 4 });
    appPool.on('error', () => undefined);
    control = new ControlDatabase(controlPool);
    tenants = new TenantDatabase(appPool);
    await asAdmin((client) =>
      client.query("insert into machvon.placement (id, kind, region, db_cluster_ref, kms_key_ref, status) values ($1, 'POOL', 'vn-north', 'north-d8', 'kms-d8', 'Active')", [PLACEMENT]),
    );
  }, 180_000);

  afterAll(async () => {
    await Promise.all([controlPool?.end(), appPool?.end()]);
    if (database) await database.stop();
  }, 60_000);

  describe('the first version', () => {
    it('stores version 1 with its pointer, and creating it again returns the same version', async () => {
      const tenantId = await seedTenant();
      const again = await inControl(tenantId, (tx) => store.createInitialVersion(tx, { tenantId, config: themeWith({ primary: '#000000' }), publishedBy: ADMIN_B }));
      expect(again).toMatchObject({ tenantId, version: 1, config: THEME_V1, hash: themeHash(THEME_V1), sourceVersion: null, publishedBy: ADMIN_A });
      expect(await inControl(tenantId, (tx) => store.currentVersion(tx, tenantId))).toMatchObject({ version: 1 });
    });

    it('answers 404 for a tenant that does not exist and for a tenant without a theme', async () => {
      expect((await failureOf(inControl('00000000-0000-4000-8000-000000000bad', (tx) => store.getDraft(tx, '00000000-0000-4000-8000-000000000bad')))).status).toBe(404);
      const bare = await seedTenant(false);
      expect((await failureOf(inControl(bare, (tx) => store.getDraft(tx, bare)))).status).toBe(404);
    });
  });

  describe('the draft', () => {
    it('is revision 0 holding the published theme until someone edits it, then counts revisions', async () => {
      const tenantId = await seedTenant();
      expect(await inControl(tenantId, (tx) => store.getDraft(tx, tenantId))).toEqual({ revision: 0, config: THEME_V1, updatedBy: null, updatedAt: null });
      const first = await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      expect(first).toMatchObject({ revision: 1, config: themeWith({ primary: '#112233' }), updatedBy: ADMIN_A });
      const second = await saveDraft(tenantId, themeWith({ primary: '#223344' }), 1, ADMIN_B);
      expect(second).toMatchObject({ revision: 2, updatedBy: ADMIN_B });
      expect((await inControl(tenantId, (tx) => store.getDraft(tx, tenantId))).config.primary).toBe('#223344');
    });

    it('refuses a save whose revision is not the current one with VERSION_CONFLICT carrying the current revision', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const error = await failureOf(saveDraft(tenantId, themeWith({ primary: '#445566' }), 0));
      expect(error).toMatchObject({ code: 'VERSION_CONFLICT', status: 409, extensions: { current_version: 1 } });
    });

    it('lets only one of two concurrent saves of the same revision win', async () => {
      const tenantId = await seedTenant();
      const outcomes = await Promise.allSettled([saveDraft(tenantId, themeWith({ primary: '#111111' }), 0), saveDraft(tenantId, themeWith({ primary: '#222222' }), 0, ADMIN_B)]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'VERSION_CONFLICT' });
    });

    it('reports the revision the winner stored when a concurrent save loses the race', async () => {
      const tenantId = await seedTenant();
      let loserHasRead!: () => void;
      let winnerHasCommitted!: () => void;
      const read = new Promise<void>((resolveRead) => (loserHasRead = resolveRead));
      const committed = new Promise<void>((resolveCommitted) => (winnerHasCommitted = resolveCommitted));
      // The loser reads revision 0, then waits to write until the winner has committed revision 1: the second guard of saveDraft.
      const loser = inControl(tenantId, (tx) => {
        const gated: typeof tx = {
          async query<R>(sql: string, params?: unknown[]): Promise<R[]> {
            if (/insert into machvon\.tenant_theme_draft/.test(sql)) await committed;
            const rows = await tx.query<R>(sql, params);
            if (/from machvon\.tenant_theme_draft where/.test(sql)) loserHasRead();
            return rows;
          },
        };
        return store.saveDraft(gated, { tenantId, config: themeWith({ primary: '#111111' }), expectedRevision: 0, actorId: ADMIN_A });
      });
      await read;
      await saveDraft(tenantId, themeWith({ primary: '#222222' }), 0, ADMIN_B);
      winnerHasCommitted();
      expect(await failureOf(loser)).toMatchObject({ code: 'VERSION_CONFLICT', status: 409, extensions: { current_version: 1 } });
    });

    it('keeps the draft of one tenant out of another (AC-ST-SAS-005-1)', async () => {
      const a = await seedTenant();
      const b = await seedTenant();
      await saveDraft(a, themeWith({ primary: '#abcdef' }), 0);
      expect((await inControl(b, (tx) => store.getDraft(tx, b))).revision).toBe(0);
      expect((await inControl(b, (tx) => store.getDraft(tx, b))).config.primary).toBe(THEME_V1.primary);
    });
  });

  describe('review and publish', () => {
    it('publishes the reviewed draft as the next version, moves the pointer and consumes the review', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const reviewed = await review(tenantId);
      expect(reviewed).toMatchObject({ baseVersion: 1, candidate: themeWith({ primary: '#112233' }), changes: [{ field: 'primary', before: '#0b5cad', after: '#112233' }] });
      expect(reviewed.token.length).toBeGreaterThanOrEqual(32);
      expect(reviewed.expiresAt.getTime()).toBe(NOW.getTime() + REVIEW_LIFETIME_MS);
      const published = await publish(tenantId, reviewed.token);
      expect(published).toMatchObject({ version: 2, config: themeWith({ primary: '#112233' }), hash: themeHash(themeWith({ primary: '#112233' })), sourceVersion: null, publishedBy: ADMIN_A });
      expect(await inControl(tenantId, (tx) => store.currentVersion(tx, tenantId))).toMatchObject({ version: 2 });
      const consumed = await asAdmin((client) => client.query('select consumed_at from machvon.tenant_theme_review where tenant_id = $1', [tenantId]));
      expect(consumed.rows[0].consumed_at).not.toBeNull();
    });

    it('clears the draft it published and no other, so the editor shows the published theme again', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const reviewed = await review(tenantId);
      await publish(tenantId, reviewed.token);
      expect(await inControl(tenantId, (tx) => store.getDraft(tx, tenantId))).toEqual({ revision: 0, config: themeWith({ primary: '#112233' }), updatedBy: null, updatedAt: null });
      expect((await asAdmin((client) => client.query('select 1 from machvon.tenant_theme_draft where tenant_id = $1', [tenantId]))).rows).toHaveLength(0);
      // Rolling back afterwards shows the restored theme, not the configuration that was just rolled back.
      const restore = await inControl(tenantId, (tx) => store.createReview(tx, { tenantId, actorId: ADMIN_A, baseVersion: 2, sourceVersion: 1, reason: REASON, now: NOW }));
      await publish(tenantId, restore.token, ADMIN_A, 2);
      expect((await inControl(tenantId, (tx) => store.getDraft(tx, tenantId))).config).toEqual(THEME_V1);
    });

    it('keeps an unrelated draft when a rollback is published', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      await publish(tenantId, (await review(tenantId)).token);
      await saveDraft(tenantId, themeWith({ primary: '#445566' }), 0);
      const restore = await inControl(tenantId, (tx) => store.createReview(tx, { tenantId, actorId: ADMIN_A, baseVersion: 2, sourceVersion: 1, reason: REASON, now: NOW }));
      await publish(tenantId, restore.token, ADMIN_A, 2);
      expect(await inControl(tenantId, (tx) => store.getDraft(tx, tenantId))).toMatchObject({ revision: 1, config: themeWith({ primary: '#445566' }) });
    });

    it('stores only a hash of the token', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const reviewed = await review(tenantId);
      const rows = await asAdmin((client) => client.query('select token_hash from machvon.tenant_theme_review where tenant_id = $1', [tenantId]));
      expect(rows.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(rows.rows[0].token_hash).not.toBe(reviewed.token);
    });

    it('answers REVIEW_INVALID the second time a review is used (AC-ST-SAS-005-9)', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const reviewed = await review(tenantId);
      await publish(tenantId, reviewed.token);
      expect(await failureOf(publish(tenantId, reviewed.token, ADMIN_A, 2))).toMatchObject({ code: 'REVIEW_INVALID', status: 409 });
    });

    it('answers REVIEW_INVALID for an expired review, a review of another person and a token nobody issued', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const reviewed = await review(tenantId);
      const late = new Date(NOW.getTime() + REVIEW_LIFETIME_MS);
      expect(await failureOf(publish(tenantId, reviewed.token, ADMIN_A, 1, late))).toMatchObject({ code: 'REVIEW_INVALID', status: 409 });
      expect(await failureOf(publish(tenantId, reviewed.token, ADMIN_B))).toMatchObject({ code: 'REVIEW_INVALID', status: 409 });
      expect(await failureOf(publish(tenantId, 'x'.repeat(43)))).toMatchObject({ code: 'REVIEW_INVALID', status: 409 });
      expect(await publish(tenantId, reviewed.token, ADMIN_A, 1, new Date(NOW.getTime() + REVIEW_LIFETIME_MS - 1))).toMatchObject({ version: 2 });
    });

    it('answers REVIEW_INVALID for a review issued for another tenant, never revealing that it exists', async () => {
      const a = await seedTenant();
      const b = await seedTenant();
      await saveDraft(a, themeWith({ primary: '#112233' }), 0);
      const reviewed = await review(a);
      expect(await failureOf(publish(b, reviewed.token))).toMatchObject({ code: 'REVIEW_INVALID', status: 409 });
    });

    it('answers REVIEW_INVALID when the draft changed after the review', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const reviewed = await review(tenantId);
      await saveDraft(tenantId, themeWith({ primary: '#999999' }), 1);
      expect(await failureOf(publish(tenantId, reviewed.token))).toMatchObject({ code: 'REVIEW_INVALID', status: 409 });
    });

    it('has nothing to review before the draft is edited', async () => {
      const tenantId = await seedTenant();
      expect(await failureOf(review(tenantId))).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    });

    it('answers VERSION_CONFLICT for a base version that is not the published one, when reviewing and when publishing', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const stale = await failureOf(review(tenantId, ADMIN_A, 7));
      expect(stale).toMatchObject({ code: 'VERSION_CONFLICT', status: 409, extensions: { current_version: 1 } });
      const reviewed = await review(tenantId);
      expect(await failureOf(publish(tenantId, reviewed.token, ADMIN_A, 3))).toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    });

    it('lets only one of two concurrent publishers of the same base win (AC-ST-SAS-005-3)', async () => {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      const first = await review(tenantId, ADMIN_A);
      const second = await review(tenantId, ADMIN_B);
      const outcomes = await Promise.allSettled([publish(tenantId, first.token, ADMIN_A), publish(tenantId, second.token, ADMIN_B)]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'VERSION_CONFLICT' });
      expect(await inControl(tenantId, (tx) => store.currentVersion(tx, tenantId))).toMatchObject({ version: 2 });
    });

    it('lists versions newest first and pages by the last version of the page before', async () => {
      const tenantId = await seedTenant();
      for (let base = 1; base <= 3; base += 1) {
        const draft = await inControl(tenantId, (tx) => store.getDraft(tx, tenantId));
        await saveDraft(tenantId, themeWith({ primary: `#00000${base}` }), draft.revision);
        const reviewed = await review(tenantId, ADMIN_A, base);
        await publish(tenantId, reviewed.token, ADMIN_A, base);
      }
      const page = await inControl(tenantId, (tx) => store.listVersions(tx, tenantId, { limit: 2 }));
      expect(page.map((row) => row.version)).toEqual([4, 3]);
      const next = await inControl(tenantId, (tx) => store.listVersions(tx, tenantId, { limit: 2, after: { version: 3 } }));
      expect(next.map((row) => row.version)).toEqual([2, 1]);
    });
  });

  describe('rolling back', () => {
    async function publishedTwice(): Promise<string> {
      const tenantId = await seedTenant();
      await saveDraft(tenantId, themeWith({ primary: '#112233' }), 0);
      await publish(tenantId, (await review(tenantId)).token);
      return tenantId;
    }

    const rollbackReview = (tenantId: string, sourceVersion: number, reason: string, baseVersion = 2): Promise<Awaited<ReturnType<ThemeStore['createReview']>>> =>
      inControl(tenantId, (tx) => store.createReview(tx, { tenantId, actorId: ADMIN_A, baseVersion, sourceVersion, reason, now: NOW }));

    it('publishes a new version from an old one, naming the source and the reason', async () => {
      const tenantId = await publishedTwice();
      const reviewed = await rollbackReview(tenantId, 1, REASON);
      expect(reviewed.candidate).toEqual(THEME_V1);
      expect(reviewed.changes).toEqual([{ field: 'primary', before: '#112233', after: '#0b5cad' }]);
      const restored = await publish(tenantId, reviewed.token, ADMIN_A, 2);
      expect(restored).toMatchObject({ version: 3, sourceVersion: 1, reason: REASON, hash: themeHash(THEME_V1), config: THEME_V1 });
      const versions = await inControl(tenantId, (tx) => store.listVersions(tx, tenantId, { limit: 10 }));
      expect(versions.map((row) => row.version)).toEqual([3, 2, 1]);
    });

    it('needs a reason of at least ten characters and a source version that exists', async () => {
      const tenantId = await publishedTwice();
      expect(await failureOf(rollbackReview(tenantId, 1, 'too short'))).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
      expect(await failureOf(rollbackReview(tenantId, 1, '          '))).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
      expect(await failureOf(rollbackReview(tenantId, 9, REASON))).toMatchObject({ status: 404 });
    });
  });

  describe('who may reach the tables', () => {
    it('lets the tenant plane read the published version and pointer of its own tenant only', async () => {
      const a = await seedTenant();
      const b = await seedTenant();
      const ctx = (tenantId: string) => ({ tenantId, membershipId: ADMIN_A, scopeVersion: 1 });
      const seen = await tenants.withTenant(ctx(a), (tx) => tx.query<{ tenant_id: string }>('select tenant_id from machvon.tenant_theme_version'));
      expect(seen.map((row) => row.tenant_id)).toEqual([a]);
      const pointer = await tenants.withTenant(ctx(b), (tx) => tx.query<{ tenant_id: string }>('select tenant_id from machvon.tenant_theme_pointer'));
      expect(pointer.map((row) => row.tenant_id)).toEqual([b]);
    });

    it('denies the tenant plane every write and every read of a draft, a review and an asset', async () => {
      const a = await seedTenant();
      const ctx = { tenantId: a, membershipId: ADMIN_A, scopeVersion: 1 };
      const denied = async (sql: string): Promise<void> => {
        await expect(tenants.withTenant(ctx, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
      };
      await denied('select * from machvon.tenant_theme_draft');
      await denied('select * from machvon.tenant_theme_review');
      await denied('select * from machvon.tenant_theme_asset');
      await denied("update machvon.tenant_theme_pointer set current_version = 1 where tenant_id = tenant_id");
      await denied('delete from machvon.tenant_theme_version');
      await denied(`insert into machvon.tenant_theme_draft (tenant_id, revision, config_json, updated_by) values ('${a}', 1, '{}', '${ADMIN_A}')`);
    });

    it('never lets the control plane change or delete a published version', async () => {
      const tenantId = await seedTenant();
      await expect(inControl(tenantId, (tx) => tx.query('update machvon.tenant_theme_version set config_json = $1::jsonb where tenant_id = $2::uuid', ['{}', tenantId]))).rejects.toThrow(/permission denied/);
      await expect(inControl(tenantId, (tx) => tx.query('delete from machvon.tenant_theme_version where tenant_id = $1::uuid', [tenantId]))).rejects.toThrow(/permission denied/);
    });

    it('keeps a version from carrying a restored source without a reason of ten characters', async () => {
      const tenantId = await seedTenant();
      await expect(
        inControl(tenantId, (tx) =>
          tx.query(
            "insert into machvon.tenant_theme_version (tenant_id, version, config_json, config_hash, source_version, published_by, reason) values ($1::uuid, 2, '{}', $2, 1, $3::uuid, 'short')",
            [tenantId, 'a'.repeat(64), ADMIN_A],
          ),
        ),
      ).rejects.toThrow(/check constraint/);
    });
  });

  describe('assets', () => {
    const asset = (tenantId: string, suffix: string) => ({
      tenantId,
      contentHash: 'b'.repeat(64),
      mime: 'image/png',
      sizeBytes: 2048,
      storageKey: `theme/${tenantId}/${suffix}`,
      scanStatus: 'clean' as const,
      createdBy: ADMIN_A,
    });

    it('registers an asset of the tenant and finds it, and another tenant finds nothing', async () => {
      const a = await seedTenant();
      const b = await seedTenant();
      const stored = await inControl(a, (tx) => store.registerAsset(tx, asset(a, 'one')));
      expect(stored).toMatchObject({ tenantId: a, mime: 'image/png', sizeBytes: 2048, scanStatus: 'clean', storageKey: `theme/${a}/one` });
      expect(await inControl(a, (tx) => store.findAsset(tx, a, stored.id))).toEqual(stored);
      expect(await inControl(b, (tx) => store.findAsset(tx, b, stored.id))).toBeUndefined();
    });

    it('refuses an asset above 1 MiB, an SVG and a mime type nobody allowed (AC-ST-SAS-005-4)', async () => {
      const tenantId = await seedTenant();
      await expect(inControl(tenantId, (tx) => store.registerAsset(tx, { ...asset(tenantId, 'big'), sizeBytes: 1_048_577 }))).rejects.toThrow(/check constraint/);
      await expect(inControl(tenantId, (tx) => store.registerAsset(tx, { ...asset(tenantId, 'svg'), mime: 'image/svg+xml' }))).rejects.toThrow(/check constraint/);
    });
  });
});
