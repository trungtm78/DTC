import { DomainError } from '@machvon/kernel';
import type { EffectiveAccess, GrantView, Scope } from '@machvon/kernel';
import { SearchProjectionStore } from '../src/search-projection';
import type { SearchDocumentInput } from '../src/search-projection';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, id, memberId, unitId } from './support/authz-fixtures';

const NOW = new Date('2026-06-01T10:00:00Z');
const PERMISSION = 'search.use';
const path = (...ns: number[]): string => `/${ns.map(unitId).join('/')}/`;
const ROOT = path(1);
const UNIT_2 = path(1, 2);
const UNIT_3 = path(1, 3);

const grant = (scope: Scope, permissions: string[] = [PERMISSION]): GrantView => ({
  roleCode: 'SEARCHER',
  rank: 10,
  permissions,
  scope,
  status: 'Active',
  effectiveFrom: new Date(0),
  effectiveUntil: null,
});

const accessOf = (...grants: GrantView[]): EffectiveAccess => ({ membershipId: memberId(1), scopeVersion: 1, membershipActive: true, grants });
const WHOLE_TENANT = accessOf(grant({ kind: 'TENANT' }));
const UNIT_2_ONLY = accessOf(grant({ kind: 'UNIT_SUBTREE', refIds: [unitId(2)], paths: [UNIT_2] }));

function document(n: number, overrides: Partial<SearchDocumentInput> = {}): SearchDocumentInput {
  return {
    entityType: 'project',
    entityId: id(0x80, n),
    title: `Tender XL-01 package ${n}`,
    body: `Works for road section ${n}`,
    classification: 'INTERNAL',
    ownerUnitId: unitId(2),
    ownerUnitPath: UNIT_2,
    ...overrides,
  };
}

describe('search projection (ST-IAM-008, ST-KERNEL-025)', () => {
  const harness = new AuthzHarness();
  const store = new SearchProjectionStore();

  const upsert = (tenantId: string, input: SearchDocumentInput): Promise<void> =>
    harness.tenants.withTenant(contextFor(tenantId, memberId(1)), (tx) => store.upsert(tx, tenantId, input));

  const search = (tenantId: string, access: EffectiveAccess, query: string, options: { limit?: number; cursor?: string } = {}) =>
    harness.tenants.withTenant(contextFor(tenantId, memberId(1)), (tx) =>
      store.search(tx, { tenantId, access, permission: PERMISSION, now: NOW, query, limit: options.limit ?? 50, cursor: options.cursor }),
    );

  const idsOf = (page: { items: Array<{ entityId: string }> }): string[] => page.items.map((item) => item.entityId);

  beforeAll(async () => {
    await harness.start();
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  }, 60_000);

  describe('tenant filter', () => {
    it('returns only the documents of the tenant that asks, although both tenants hold a document with the same name', async () => {
      await upsert(TENANT_A, document(1, { title: 'Tender XL-01', ownerUnitPath: ROOT }));
      await upsert(TENANT_B, document(2, { title: 'Tender XL-01', ownerUnitPath: ROOT }));
      const a = await search(TENANT_A, WHOLE_TENANT, 'Tender XL-01');
      const b = await search(TENANT_B, WHOLE_TENANT, 'Tender XL-01');
      expect(idsOf(a)).toEqual([id(0x80, 1)]);
      expect(idsOf(b)).toEqual([id(0x80, 2)]);
    });

    it('does not find the document of another tenant by its id, its title or part of its text', async () => {
      await upsert(TENANT_B, document(3, { title: 'Beta confidential airport', body: 'Beta secret budget line', ownerUnitPath: ROOT }));
      for (const query of ['Beta confidential airport', 'secret budget', 'Beta']) {
        const page = await search(TENANT_A, WHOLE_TENANT, query);
        expect(page).toEqual({ items: [], nextCursor: null });
      }
    });

    it('does not let a row of another tenant be written by naming the tenant', async () => {
      await expect(
        harness.tenants.withTenant(contextFor(TENANT_A, memberId(1)), (tx) => store.upsert(tx, TENANT_B, document(4, { title: 'Planted in B', ownerUnitPath: ROOT }))),
      ).rejects.toThrow();
      expect(idsOf(await search(TENANT_B, WHOLE_TENANT, 'Planted'))).toEqual([]);
    });
  });

  describe('access filter, applied before ranking', () => {
    beforeAll(async () => {
      await upsert(TENANT_A, document(10, { title: 'Culvert works', body: 'culvert', ownerUnitId: unitId(2), ownerUnitPath: UNIT_2 }));
      // The best match by far is in a unit that the unit-2 reader may not see.
      await upsert(TENANT_A, document(11, { title: 'Culvert culvert culvert', body: 'culvert culvert culvert culvert culvert', ownerUnitId: unitId(3), ownerUnitPath: UNIT_3 }));
      await upsert(TENANT_A, document(12, { title: 'Culvert extension', body: 'one more culvert', ownerUnitId: unitId(2), ownerUnitPath: path(1, 2, 4) }));
    });

    it('shows a reader of the whole tenant every match, best first', async () => {
      const page = await search(TENANT_A, WHOLE_TENANT, 'culvert');
      expect(idsOf(page)).toEqual([id(0x80, 11), id(0x80, 10), id(0x80, 12)]);
    });

    it('shows a reader of one unit subtree only the documents under it, even though a better match exists outside', async () => {
      const page = await search(TENANT_A, UNIT_2_ONLY, 'culvert');
      expect(idsOf(page)).toEqual([id(0x80, 10), id(0x80, 12)]);
      expect(JSON.stringify(page)).not.toContain(id(0x80, 11));
    });

    it('does not return an out-of-scope document on any page, however small the pages are', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 5; guard += 1) {
        const page = await search(TENANT_A, UNIT_2_ONLY, 'culvert', { limit: 1, cursor });
        seen.push(...idsOf(page));
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(seen).toEqual([id(0x80, 10), id(0x80, 12)]);
    });

    it('matches a subtree on whole path segments, not on a shared prefix', async () => {
      await upsert(TENANT_A, document(13, { title: 'Culvert lookalike', body: 'culvert', ownerUnitId: id(0x10, 22), ownerUnitPath: `/${unitId(1)}/${unitId(2)}0/` }));
      const page = await search(TENANT_A, UNIT_2_ONLY, 'lookalike');
      expect(page.items).toEqual([]);
    });

    it('shows a reader of a single unit the documents of that unit only', async () => {
      const only = accessOf(grant({ kind: 'UNIT_ONLY', refIds: [unitId(3)] }));
      expect(idsOf(await search(TENANT_A, only, 'culvert'))).toEqual([id(0x80, 11)]);
    });

    it('shows nothing, and no count, to someone without the search permission or with a grant that cannot be judged on a unit', async () => {
      const noPermission = accessOf(grant({ kind: 'TENANT' }, ['project.read']));
      expect(await search(TENANT_A, noPermission, 'culvert')).toEqual({ items: [], nextCursor: null });
      const projectGrant = accessOf(grant({ kind: 'PROJECT', refIds: [id(0x50, 1)] }));
      expect(await search(TENANT_A, projectGrant, 'culvert')).toEqual({ items: [], nextCursor: null });
      expect(await search(TENANT_A, accessOf(), 'culvert')).toEqual({ items: [], nextCursor: null });
      expect(await search(TENANT_A, { ...WHOLE_TENANT, membershipActive: false }, 'culvert')).toEqual({ items: [], nextCursor: null });
      expect(Object.keys(await search(TENANT_A, UNIT_2_ONLY, 'culvert')).sort()).toEqual(['items', 'nextCursor']);
    });
  });

  describe('paging', () => {
    beforeAll(async () => {
      for (let n = 20; n < 27; n += 1) {
        await upsert(TENANT_A, document(n, { title: `Bridge inspection ${n}`, body: n % 2 === 0 ? 'bridge bridge inspection' : 'bridge', ownerUnitPath: UNIT_2 }));
      }
    });

    it('walks all pages without a gap or a repeat, in the order of one big page', async () => {
      const whole = idsOf(await search(TENANT_A, WHOLE_TENANT, 'bridge'));
      expect(whole).toHaveLength(7);
      const walked: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await search(TENANT_A, WHOLE_TENANT, 'bridge', { limit: 3, cursor });
        expect(page.items.length).toBeLessThanOrEqual(3);
        walked.push(...idsOf(page));
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(walked).toEqual(whole);
    });

    it('refuses a cursor that this store did not issue', async () => {
      for (const cursor of ['x', 'not base64 !', Buffer.from('[1]').toString('base64url'), Buffer.from('["a","b"]').toString('base64url'), Buffer.from('[1,"nope"]').toString('base64url')]) {
        await expect(search(TENANT_A, WHOLE_TENANT, 'bridge', { cursor })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
      }
      await expect(search(TENANT_A, WHOLE_TENANT, 'bridge', { cursor: Buffer.from('[1,"nope"]').toString('base64url') })).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('masking per classification', () => {
    it('shows a snippet of a public or internal document and none of a confidential or personal one; a personal title is hidden', async () => {
      const text = 'quartz quartz field notes';
      await upsert(TENANT_A, document(30, { title: 'Quartz public', body: text, classification: 'PUBLIC', ownerUnitPath: ROOT }));
      await upsert(TENANT_A, document(31, { title: 'Quartz internal', body: text, classification: 'INTERNAL', ownerUnitPath: ROOT }));
      await upsert(TENANT_A, document(32, { title: 'Quartz confidential', body: text, classification: 'CONFIDENTIAL', ownerUnitPath: ROOT }));
      await upsert(TENANT_A, document(33, { title: 'Quartz personal', body: text, classification: 'PERSONAL', ownerUnitPath: ROOT }));
      const page = await search(TENANT_A, WHOLE_TENANT, 'quartz');
      const byId = new Map(page.items.map((item) => [item.entityId, item]));
      expect(byId.get(id(0x80, 30))?.snippet).toContain('quartz');
      expect(byId.get(id(0x80, 31))?.snippet).toContain('quartz');
      expect(byId.get(id(0x80, 32))).toMatchObject({ title: 'Quartz confidential', snippet: null });
      expect(byId.get(id(0x80, 33))).toMatchObject({ title: null, snippet: null, classification: 'PERSONAL' });
      expect(JSON.stringify(page)).not.toContain('Quartz personal');
    });
  });

  describe('maintaining the projection', () => {
    it('replaces a document that is projected again and drops one that is removed', async () => {
      const entityId = id(0x80, 40);
      await upsert(TENANT_A, document(40, { title: 'Original zebra title', ownerUnitPath: ROOT }));
      expect(idsOf(await search(TENANT_A, WHOLE_TENANT, 'zebra'))).toEqual([entityId]);
      await upsert(TENANT_A, document(40, { title: 'Renamed giraffe title', body: '', ownerUnitPath: ROOT }));
      expect(idsOf(await search(TENANT_A, WHOLE_TENANT, 'zebra'))).toEqual([]);
      expect(idsOf(await search(TENANT_A, WHOLE_TENANT, 'giraffe'))).toEqual([entityId]);
      await harness.tenants.withTenant(contextFor(TENANT_A, memberId(1)), (tx) => store.remove(tx, TENANT_A, 'project', entityId));
      expect(idsOf(await search(TENANT_A, WHOLE_TENANT, 'giraffe'))).toEqual([]);
    });

    it('keeps one projection per entity: the same id of another type is another document', async () => {
      await upsert(TENANT_A, document(41, { entityType: 'project', title: 'Narwhal project', ownerUnitPath: ROOT }));
      await upsert(TENANT_A, document(41, { entityType: 'contract', title: 'Narwhal contract', ownerUnitPath: ROOT }));
      const page = await search(TENANT_A, WHOLE_TENANT, 'narwhal');
      expect(page.items.map((item) => item.entityType).sort()).toEqual(['contract', 'project']);
    });
  });

  describe('queries', () => {
    it('treats search syntax as text: quotes, operators and half-written expressions never fail', async () => {
      for (const query of ['"unclosed', "o'brien", 'a & | ! ( ) :*', '\\', '-minus -', 'OR', 'and and', '%_']) {
        await expect(search(TENANT_A, WHOLE_TENANT, query)).resolves.toMatchObject({ nextCursor: null });
      }
    });

    it('finds nothing for a query made only of ignorable characters', async () => {
      expect(await search(TENANT_A, WHOLE_TENANT, '   ')).toEqual({ items: [], nextCursor: null });
      expect(await search(TENANT_A, WHOLE_TENANT, '!!!')).toEqual({ items: [], nextCursor: null });
    });

    it('supports a phrase and an exclusion', async () => {
      await upsert(TENANT_A, document(50, { title: 'Harbour dredging plan', body: 'dredging of the harbour basin', ownerUnitPath: ROOT }));
      await upsert(TENANT_A, document(51, { title: 'Harbour lighting plan', body: 'lighting of the harbour quay', ownerUnitPath: ROOT }));
      expect(idsOf(await search(TENANT_A, WHOLE_TENANT, '"harbour dredging"'))).toEqual([id(0x80, 50)]);
      expect(idsOf(await search(TENANT_A, WHOLE_TENANT, 'harbour -lighting'))).toEqual([id(0x80, 50)]);
    });
  });
});
