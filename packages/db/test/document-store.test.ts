import { randomUUID } from 'node:crypto';
import { DomainError, ND30_A4_STANDARD } from '@machvon/kernel';
import type { EffectiveAccess, GrantView, Scope } from '@machvon/kernel';
import { Client } from 'pg';
import { DocumentStore, VERSION_SCOPE_COLUMNS } from '../src/document-store';
import { scopePredicate } from '../src/scope-version';
import type { NewDocumentVersion } from '../src/document-store';
import { ACTOR, AuthzHarness, TENANT_A, TENANT_B, contextFor, memberId, unitId } from './support/authz-fixtures';

const harness = new AuthzHarness();
const store = new DocumentStore();
const sha = (seed: string): string => seed.repeat(64).slice(0, 64);

const ctxA = contextFor(TENANT_A, memberId(1));
const ctxB = contextFor(TENANT_B, memberId(1));

function accessWith(scope: Scope): EffectiveAccess {
  const grant: GrantView = {
    roleCode: 'READER',
    rank: 10,
    permissions: ['doc.outgoing.read'],
    scope,
    status: 'Active',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveUntil: null,
  };
  return { membershipId: memberId(1), scopeVersion: 1, membershipActive: true, grants: [grant] };
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string; sqlState?: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return { code: error.code };
    return { code: 'DB', sqlState: (error as { code?: string }).code };
  }
  throw new Error('expected a rejection');
}

function versionInput(documentId: string, overrides: Partial<NewDocumentVersion> = {}): NewDocumentVersion {
  return {
    documentId,
    objectKey: `t/${TENANT_A}/doc/${randomUUID()}.pdf`,
    checksum: sha('a'),
    mime: 'application/pdf',
    pageCount: 1,
    classification: 'INTERNAL',
    stage: 'RENDERED_FINAL',
    byteLength: 1234,
    rendererVersion: 'renderer-1',
    createdBy: ACTOR,
    ...overrides,
  };
}

async function seedTemplate(
  tenantId: string,
  profileId: string,
  options: { code: string; revision: number; status?: string; from: string; until?: string | null; form?: string | null; confirmed?: boolean },
): Promise<string> {
  const templateId = randomUUID();
  const confirmed = options.confirmed ?? true;
  await harness.owner(tenantId, [
    [
      `insert into machvon.document_template
         (tenant_id, id, template_code, revision, group_code, doc_type_code, form_code, title, layout_profile_id, body_blocks,
          placeholder_schema, legal_basis, confirmation_status, legal_confirmation_ref, legal_confirmed_by, legal_confirmed_at, watermark_text,
          content_sha256, effective_from, effective_until, status, created_by, updated_by)
       values ($1, $2, $3, $4, 'DECISION', 'QD', $5, 'Decision', $6, '[]'::jsonb, '{}'::jsonb, 'ND 30/2020', $7,
          case when $8 then 'LEGAL-1' end, case when $8 then $12::uuid end, case when $8 then now() end, case when $8 then null else 'DRAFT' end,
          $9, $10::date, $11::date, $13, $12, $12)`,
      [
        tenantId,
        templateId,
        options.code,
        options.revision,
        options.form ?? null,
        profileId,
        confirmed ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
        confirmed,
        sha('c'),
        options.from,
        options.until ?? null,
        ACTOR,
        options.status ?? 'PUBLISHED',
      ],
    ],
  ]);
  return templateId;
}

describe('DocumentStore', () => {
  let profileA = '';

  beforeAll(async () => {
    await harness.start();
    await harness.seedUnits(TENANT_A, [
      { n: 1, path: '/a/1/' },
      { n: 2, path: '/a/2/' },
    ]);
    profileA = (await harness.tenants.withTenant(ctxA, (tx) => store.seedDefaults(tx, ACTOR))).layoutProfileId;
  }, 180_000);

  afterAll(() => harness.stop(), 60_000);

  describe('seedDefaults and layout profiles', () => {
    it('seeds ND30_A4_STANDARD r1 as a published profile that waits for legal confirmation, once', async () => {
      const again = await harness.tenants.withTenant(ctxA, (tx) => store.seedDefaults(tx, ACTOR));
      expect(again.layoutProfileId).toBe(profileA);
      const record = await harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileByCode(tx, 'ND30_A4_STANDARD', '2026-10-23'));
      expect(record.id).toBe(profileA);
      expect(record.profile.code).toBe('ND30_A4_STANDARD');
      expect(record.profile.marginsMm).toEqual(ND30_A4_STANDARD.marginsMm);
      expect(record.profile.confirmationStatus).toBe('PENDING_CONFIRMATION');
      expect(record.profile.elementStyles.body.sizePt).toBe(14);
    });

    it('does not show the profile of another tenant', async () => {
      await expect(harness.tenants.withTenant(ctxB, (tx) => store.layoutProfileByCode(tx, 'ND30_A4_STANDARD', '2026-10-23'))).rejects.toMatchObject({
        code: 'PROFILE_NOT_PUBLISHED',
      });
    });

    it('refuses a date before the profile takes effect', async () => {
      await expect(harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileByCode(tx, 'ND30_A4_STANDARD', '2019-12-31'))).rejects.toMatchObject({
        code: 'PROFILE_NOT_PUBLISHED',
      });
    });

    it('finds a profile by id', async () => {
      const record = await harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileById(tx, profileA));
      expect(record.profile.revision).toBe(1);
      await expect(harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileById(tx, randomUUID()))).rejects.toMatchObject({ code: 'PROFILE_NOT_PUBLISHED' });
    });

    it('finds a profile by id only in the period it is in force when a date is given, like a profile chosen by code', async () => {
      const inForce = await harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileById(tx, profileA, '2026-10-23'));
      expect(inForce.id).toBe(profileA);
      await expect(harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileById(tx, profileA, '2019-12-31'))).rejects.toMatchObject({ code: 'PROFILE_NOT_PUBLISHED' });
      await harness.owner(TENANT_A, [["update machvon.document_layout_profile set effective_until = '2026-12-31' where id = $1", [profileA]]]);
      try {
        await expect(harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileById(tx, profileA, '2026-12-30'))).resolves.toMatchObject({ id: profileA });
        await expect(harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileById(tx, profileA, '2026-12-31'))).rejects.toMatchObject({ code: 'PROFILE_NOT_PUBLISHED' });
        await expect(harness.tenants.withTenant(ctxA, (tx) => store.layoutProfileById(tx, profileA, '2027-06-01'))).rejects.toMatchObject({ code: 'PROFILE_NOT_PUBLISHED' });
      } finally {
        await harness.owner(TENANT_A, [['update machvon.document_layout_profile set effective_until = null where id = $1', [profileA]]]);
      }
    });
  });

  describe('templateFor (BR-DOC-09)', () => {
    it('picks the published revision that is effective at the as-of date', async () => {
      const first = await seedTemplate(TENANT_A, profileA, { code: 'QD-STANDARD', revision: 1, from: '2026-01-01', until: '2026-07-01' });
      const second = await seedTemplate(TENANT_A, profileA, { code: 'QD-STANDARD', revision: 2, from: '2026-07-01' });
      await seedTemplate(TENANT_A, profileA, { code: 'QD-STANDARD', revision: 3, from: '2026-01-01', status: 'DRAFT' });
      const at = (date: string) => harness.tenants.withTenant(ctxA, (tx) => store.templateFor(tx, { templateCode: 'QD-STANDARD' }, date));
      expect((await at('2026-03-01')).id).toBe(first);
      expect((await at('2026-07-01')).id).toBe(second);
      expect((await at('2026-12-31')).revision).toBe(2);
    });

    it('refuses a date outside every published revision with TEMPLATE_NOT_EFFECTIVE', async () => {
      await seedTemplate(TENANT_A, profileA, { code: 'QD-NARROW', revision: 1, from: '2026-05-01', until: '2026-06-01' });
      const at = (date: string) => harness.tenants.withTenant(ctxA, (tx) => store.templateFor(tx, { templateCode: 'QD-NARROW' }, date));
      expect((await rejection(at('2026-04-30'))).code).toBe('TEMPLATE_NOT_EFFECTIVE');
      expect((await rejection(at('2026-06-01'))).code).toBe('TEMPLATE_NOT_EFFECTIVE');
      expect((await rejection(harness.tenants.withTenant(ctxA, (tx) => store.templateFor(tx, { templateCode: 'MISSING' }, '2026-05-10')))).code).toBe(
        'TEMPLATE_NOT_EFFECTIVE',
      );
    });

    it('selects by form code and keeps the confirmation state and the watermark', async () => {
      const id = await seedTemplate(TENANT_A, profileA, { code: 'TT37-03A', revision: 1, from: '2026-01-01', form: '03.a/TT', confirmed: false });
      const record = await harness.tenants.withTenant(ctxA, (tx) => store.templateFor(tx, { formCode: '03.a/TT' }, '2026-02-01'));
      expect(record.id).toBe(id);
      expect(record.confirmationStatus).toBe('PENDING_CONFIRMATION');
      expect(record.layoutProfileId).toBe(profileA);
      expect(record.watermarkText).toBe('DRAFT');
    });

    it('needs a template code or a form code', async () => {
      await expect(harness.tenants.withTenant(ctxA, (tx) => store.templateFor(tx, {}, '2026-02-01'))).rejects.toMatchObject({ code: 'TEMPLATE_NOT_EFFECTIVE' });
    });
  });

  describe('document versions (BR-DOC-16, BR-DOC-19)', () => {
    let documentId = '';

    beforeAll(async () => {
      documentId = (
        await harness.tenants.withTenant(ctxA, (tx) =>
          store.insertDocument(tx, { docKind: 'ATTACHMENT', docTypeCode: 'QD', title: 'Attachment', classification: 'INTERNAL', createdBy: ACTOR }),
        )
      ).id;
    });

    it('numbers versions from 1 and points the document at the newest', async () => {
      const first = await harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId)));
      const second = await harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId, { stage: 'ATTACHMENT' })));
      expect([first.version, second.version]).toEqual([1, 2]);
      expect(first.scanStatus).toBe('PENDING');
      expect(first.stage).toBe('RENDERED_FINAL');
      const [row] = await harness.owner<{ current_version_id: string }>(TENANT_A, [['select current_version_id from machvon.document where id = $1', [documentId]]]);
      expect(row?.current_version_id).toBe(second.id);
    });

    it('lists versions in keyset pages and finds one by id inside the tenant only', async () => {
      const page1 = await harness.tenants.withTenant(ctxA, (tx) => store.listVersions(tx, { limit: 1 }));
      expect(page1).toHaveLength(1);
      const first = page1[0];
      if (first === undefined) throw new Error('no version');
      const page2 = await harness.tenants.withTenant(ctxA, (tx) => store.listVersions(tx, { limit: 5, after: { sortKey: first.sortKey, id: first.id } }));
      expect(page2.every((row) => row.id !== first.id)).toBe(true);
      expect((await harness.tenants.withTenant(ctxA, (tx) => store.findVersion(tx, first.id)))?.id).toBe(first.id);
      expect(await harness.tenants.withTenant(ctxB, (tx) => store.findVersion(tx, first.id))).toBeUndefined();
      expect(await harness.tenants.withTenant(ctxB, (tx) => store.listVersions(tx, { limit: 10 }))).toEqual([]);
    });

    it('narrows versions to the issuer unit of the document by the scope of the caller', async () => {
      const owned = (
        await harness.tenants.withTenant(ctxA, (tx) =>
          store.insertDocument(tx, { docKind: 'OUTGOING', docTypeCode: 'QD', title: 'Owned', classification: 'INTERNAL', createdBy: ACTOR, issuerUnitId: unitId(1) }),
        )
      ).id;
      const version = await harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(owned)));
      const builder = (access: EffectiveAccess) => (first: number) => scopePredicate(access, 'doc.outgoing.read', new Date('2026-10-23T00:00:00Z'), VERSION_SCOPE_COLUMNS, first);
      const seen = async (access: EffectiveAccess, id = version.id): Promise<{ one: boolean; listed: boolean }> =>
        harness.tenants.withTenant(ctxA, async (tx) => ({
          one: (await store.findVersion(tx, id, builder(access))) !== undefined,
          listed: (await store.listVersions(tx, { limit: 100 }, builder(access))).some((row) => row.id === id),
        }));
      expect(await seen(accessWith({ kind: 'TENANT' }))).toEqual({ one: true, listed: true });
      expect(await seen(accessWith({ kind: 'UNIT_ONLY', refIds: [unitId(1)] }))).toEqual({ one: true, listed: true });
      expect(await seen(accessWith({ kind: 'UNIT_SUBTREE', refIds: [unitId(1)], paths: ['/a/1/'] }))).toEqual({ one: true, listed: true });
      expect(await seen(accessWith({ kind: 'UNIT_ONLY', refIds: [unitId(2)] }))).toEqual({ one: false, listed: false });
      // A version of a document that names no issuer unit is reached by a tenant-wide grant only.
      const bare = await harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId)));
      expect(await seen(accessWith({ kind: 'TENANT' }), bare.id)).toEqual({ one: true, listed: true });
      expect(await seen(accessWith({ kind: 'UNIT_SUBTREE', refIds: [unitId(1)], paths: ['/a/1/'] }), bare.id)).toEqual({ one: false, listed: false });
    });

    it('rejects a checksum that is not 64 hex characters', async () => {
      const failure = await rejection(harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId, { checksum: 'xyz' }))));
      expect(failure.sqlState).toBe('23514');
    });

    it('fills in the scan result once, from PENDING only', async () => {
      const version = await harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId)));
      const clean = await harness.tenants.withTenant(ctxA, (tx) => store.setScanResult(tx, version.id, 'CLEAN'));
      expect(clean.scanStatus).toBe('CLEAN');
      const again = await rejection(harness.tenants.withTenant(ctxA, (tx) => store.setScanResult(tx, version.id, 'INFECTED')));
      expect(again.code).toBe('DOCUMENT_STATE_INVALID');
    });

    it('keeps a stored version immutable for the application role: no edit, no delete, no truncate', async () => {
      const version = await harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId)));
      const edits = [
        "update machvon.document_version set checksum = repeat('b', 64) where id = $1",
        "update machvon.document_version set object_key = 'elsewhere' where id = $1",
        "update machvon.document_version set stage = 'ATTACHMENT' where id = $1",
        "update machvon.document_version set scan_status = 'PENDING', page_count = 9 where id = $1",
        "update machvon.document_version set scan_status = 'CLEAN', stage = 'ATTACHMENT' where id = $1",
        'delete from machvon.document_version where id = $1',
      ];
      for (const text of edits) {
        const failure = await rejection(harness.tenants.withTenant(ctxA, (tx) => tx.query(text, [version.id])));
        expect(failure.sqlState).toBe('42501');
      }
      const truncate = await rejection(harness.tenants.withTenant(ctxA, (tx) => tx.query('truncate machvon.document_version')));
      expect(truncate.sqlState).toBe('42501');
    });

    it('lets the migration owner edit a version (the tamper drill)', async () => {
      const version = await harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId)));
      const client = new Client({ connectionString: harness.database.urlFor('machvon_owner') });
      await client.connect();
      try {
        await client.query("select set_config('app.tenant_id', $1, false)", [TENANT_A]);
        const result = await client.query("update machvon.document_version set page_count = 2 where id = $1", [version.id]);
        expect(result.rowCount).toBe(1);
      } finally {
        await client.end();
      }
    });

    it('keeps one object key to one stored file', async () => {
      const key = `t/${TENANT_A}/doc/${randomUUID()}.pdf`;
      await harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId, { objectKey: key })));
      const failure = await rejection(harness.tenants.withTenant(ctxA, (tx) => store.appendVersion(tx, versionInput(documentId, { objectKey: key }))));
      expect(failure.sqlState).toBe('23505');
    });
  });
});
