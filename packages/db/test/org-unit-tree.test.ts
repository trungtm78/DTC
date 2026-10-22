import { DomainError } from '@machvon/kernel';
import type { TenantTx } from '../src/tenant-database';
import { createUnit, loadUnit, lockUnitTree, moveUnit, subtreeUnitIds, updateUnit } from '../src/org-unit-tree';
import type { CreateUnitInput } from '../src/org-unit-tree';
import { AuthzHarness, TENANT_A, TENANT_B, contextFor, memberId, unitId } from './support/authz-fixtures';

const harness = new AuthzHarness();
const ctxA = contextFor(TENANT_A, memberId(1));
const path = (...ns: number[]): string => `/${ns.map(unitId).join('/')}/`;

interface UnitRow {
  id: string;
  parent_id: string | null;
  path: string;
  depth: number;
  version: string;
  status: string;
  code: string;
}

async function rowsOf(tenantId: string): Promise<UnitRow[]> {
  return harness.owner<UnitRow>(tenantId, [
    ['select id, parent_id, path, depth, version::text as version, status, code from machvon.organization_unit order by path', []],
  ]);
}

const byId = (rows: UnitRow[], n: number): UnitRow => {
  const row = rows.find((candidate) => candidate.id === unitId(n));
  if (row === undefined) throw new Error(`unit ${n} missing`);
  return row;
};

const input = (code: string, parent: number, overrides: Partial<CreateUnitInput> = {}): CreateUnitInput => ({
  code,
  name: `Name ${code}`,
  parentId: unitId(parent),
  unitType: 'DEPARTMENT',
  validFrom: '2026-01-01',
  ...overrides,
});

const inTx = <T>(work: (tx: TenantTx) => Promise<T>, ctx = ctxA): Promise<T> => harness.tenants.withTenant(ctx, work);

async function failure(work: Promise<unknown>): Promise<DomainError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

/** root(1) -> a(2) -> b(3) -> c(4); root(1) -> d(5). Reseeded for every test. */
async function seedTree(tenantId = TENANT_A): Promise<void> {
  await harness.owner(tenantId, [['delete from machvon.organization_unit', []]]);
  await harness.seedUnits(tenantId, [
    { n: 1, path: path(1) },
    { n: 2, path: path(1, 2), parent: 1 },
    { n: 3, path: path(1, 2, 3), parent: 2 },
    { n: 4, path: path(1, 2, 3, 4), parent: 3 },
    { n: 5, path: path(1, 5), parent: 1 },
  ]);
}

describe('org-unit-tree', () => {
  beforeAll(async () => {
    await harness.start();
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  }, 60_000);

  beforeEach(async () => {
    await harness.owner(TENANT_A, [['delete from machvon.membership', []]]);
    await seedTree();
  });

  describe('reading helpers', () => {
    it('loads a unit, lists a subtree in path order, and does not find a unit of another tenant', async () => {
      await expect(inTx((tx) => loadUnit(tx, unitId(3)))).resolves.toEqual({ id: unitId(3), parentId: unitId(2), path: path(1, 2, 3), depth: 2, version: 1 });
      await expect(inTx((tx) => subtreeUnitIds(tx, path(1, 2)))).resolves.toEqual([2, 3, 4].map(unitId));
      await expect(inTx((tx) => subtreeUnitIds(tx, path(1, 2, 9)))).resolves.toEqual([]);
      await seedTree(TENANT_B);
      await harness.seedUnits(TENANT_B, [{ n: 9, path: path(9) }]);
      expect(await failure(inTx((tx) => loadUnit(tx, unitId(9))))).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });

    it('takes the tree lock re-entrantly within one transaction', async () => {
      await expect(inTx(async (tx) => {
        await lockUnitTree(tx);
        await lockUnitTree(tx);
        return 'locked';
      })).resolves.toBe('locked');
    });
  });

  describe('createUnit', () => {
    it('creates a unit under its parent with the closed path, depth, status Active and version 1', async () => {
      const created = await inTx((tx) => createUnit(tx, input('NEW', 5, { isInvestor: true, administrativeCode: 'X01' })));
      expect(created.path).toBe(`${path(1, 5)}${created.id}/`);
      expect(created.depth).toBe(2);
      expect(created.version).toBe(1);
      const rows = await rowsOf(TENANT_A);
      const row = rows.find((candidate) => candidate.id === created.id);
      expect(row).toMatchObject({ parent_id: unitId(5), depth: 2, status: 'Active', version: '1' });
    });

    it('creates a unit whose validity starts in the future as Planned', async () => {
      const created = await inTx((tx) => createUnit(tx, input('FUT', 1, { validFrom: '2999-01-01' })));
      const row = (await rowsOf(TENANT_A)).find((candidate) => candidate.id === created.id);
      expect(row?.status).toBe('Planned');
    });

    it('refuses depth 9 with UNIT_DEPTH_EXCEEDED and creates nothing', async () => {
      let parent = unitId(4); // depth 3
      let depth = 3;
      for (let level = 4; level <= 8; level += 1) {
        const created = await inTx((tx) => createUnit(tx, { ...input(`D${level}`, 1), parentId: parent }));
        expect(created.depth).toBe(level);
        parent = created.id;
        depth = created.depth;
      }
      expect(depth).toBe(8);
      const error = await failure(inTx((tx) => createUnit(tx, { ...input('TOODEEP', 1), parentId: parent })));
      expect(error).toMatchObject({ code: 'UNIT_DEPTH_EXCEEDED', status: 422 });
      expect((await rowsOf(TENANT_A)).some((row) => row.code === 'TOODEEP')).toBe(false);
    });

    it('refuses a duplicate code among Planned and Active units with UNIT_CODE_TAKEN, but allows one of a Superseded unit', async () => {
      const error = await failure(inTx((tx) => createUnit(tx, input('U2', 1))));
      expect(error).toMatchObject({ code: 'UNIT_CODE_TAKEN', status: 409 });
      await harness.owner(TENANT_A, [["update machvon.organization_unit set status = 'Superseded' where id = $1", [unitId(5)]]]);
      await expect(inTx((tx) => createUnit(tx, input('U5', 1)))).resolves.toMatchObject({ depth: 1 });
    });

    it.each([
      ['starts before the parent', { validFrom: '2025-12-31' }],
      ['ends before it starts', { validFrom: '2026-06-01', validUntil: '2026-06-01' }],
    ])('refuses a unit whose validity %s with UNIT_VALIDITY_INVALID', async (_label, overrides) => {
      const error = await failure(inTx((tx) => createUnit(tx, input('VAL', 1, overrides))));
      expect(error).toMatchObject({ code: 'UNIT_VALIDITY_INVALID', status: 422 });
    });

    it('refuses a unit that outlives its parent', async () => {
      await harness.owner(TENANT_A, [["update machvon.organization_unit set valid_until = date '2027-01-01' where id = $1", [unitId(5)]]]);
      const error = await failure(inTx((tx) => createUnit(tx, input('LONG', 5, { validUntil: '2028-01-01' }))));
      expect(error.code).toBe('UNIT_VALIDITY_INVALID');
      await expect(inTx((tx) => createUnit(tx, input('OK', 5, { validUntil: '2027-01-01' })))).resolves.toBeDefined();
    });

    it('answers RESOURCE_NOT_FOUND for a parent that belongs to another tenant or does not exist', async () => {
      await seedTree(TENANT_B);
      await harness.seedUnits(TENANT_B, [{ n: 9, path: path(9) }]);
      for (const parentId of [unitId(9), '00000000-0000-4000-8000-0000000000ff']) {
        const error = await failure(inTx((tx) => createUnit(tx, { ...input('FOREIGN', 1), parentId })));
        expect(error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
      }
    });
  });

  describe('database errors other than a duplicate code', () => {
    it('are not turned into UNIT_CODE_TAKEN', async () => {
      await expect(inTx((tx) => createUnit(tx, input('BADTYPE', 1, { unitType: 'KINGDOM' })))).rejects.toMatchObject({ code: '23514' });
      await expect(inTx((tx) => updateUnit(tx, unitId(2), { isInvestor: 'maybe' as unknown as boolean }, 1))).rejects.toMatchObject({ code: '22P02' });
    });
  });

  describe('updateUnit', () => {
    it('renames, changes the code and bumps the version', async () => {
      const result = await inTx((tx) => updateUnit(tx, unitId(2), { name: 'Renamed', code: 'NEWCODE', isInvestor: true }, 1));
      expect(result.version).toBe(2);
      const row = byId(await rowsOf(TENANT_A), 2);
      expect(row).toMatchObject({ code: 'NEWCODE', version: '2' });
    });

    it('answers VERSION_CONFLICT with the current version for a stale If-Match', async () => {
      await inTx((tx) => updateUnit(tx, unitId(2), { name: 'First' }, 1));
      const error = await failure(inTx((tx) => updateUnit(tx, unitId(2), { name: 'Second' }, 1)));
      expect(error).toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
      expect(error.extensions).toMatchObject({ current_version: 2 });
    });

    it('answers UNIT_CODE_TAKEN when the new code belongs to another active unit', async () => {
      const error = await failure(inTx((tx) => updateUnit(tx, unitId(2), { code: 'U5' }, 1)));
      expect(error.code).toBe('UNIT_CODE_TAKEN');
    });

    it('answers RESOURCE_NOT_FOUND for an unknown unit and for another tenant\'s unit', async () => {
      await seedTree(TENANT_B);
      await expect(failure(inTx((tx) => updateUnit(tx, '00000000-0000-4000-8000-0000000000ff', { name: 'X' }, 1)))).resolves.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
      const other = contextFor(TENANT_B, memberId(1));
      await expect(inTx((tx) => updateUnit(tx, unitId(2), { name: 'Mine now' }, 1), other)).resolves.toMatchObject({ version: 2 });
      expect(byId(await rowsOf(TENANT_A), 2).version).toBe('1');
    });

    it('changes nothing for an empty patch except returning the current version', async () => {
      await expect(inTx((tx) => updateUnit(tx, unitId(2), {}, 1))).resolves.toEqual({ version: 1 });
    });
  });

  describe('moveUnit', () => {
    it('rewrites the path and depth of the whole subtree, sets the parent and bumps every version', async () => {
      const result = await inTx((tx) => moveUnit(tx, unitId(2), unitId(5), 1));
      expect(result.oldPath).toBe(path(1, 2));
      expect(result.newPath).toBe(path(1, 5, 2));
      expect([...result.affectedUnitIds].sort()).toEqual([unitId(2), unitId(3), unitId(4)].sort());
      expect(result.version).toBe(2);
      const rows = await rowsOf(TENANT_A);
      expect(byId(rows, 2)).toMatchObject({ parent_id: unitId(5), path: path(1, 5, 2), depth: 2, version: '2' });
      expect(byId(rows, 3)).toMatchObject({ path: path(1, 5, 2, 3), depth: 3, version: '2' });
      expect(byId(rows, 4)).toMatchObject({ path: path(1, 5, 2, 3, 4), depth: 4, version: '2' });
      expect(byId(rows, 5)).toMatchObject({ path: path(1, 5), version: '1' });
    });

    it('moving to the current parent changes nothing', async () => {
      const result = await inTx((tx) => moveUnit(tx, unitId(2), unitId(1), 1));
      expect(result.affectedUnitIds).toEqual([]);
      expect(result.version).toBe(1);
      expect(byId(await rowsOf(TENANT_A), 2).version).toBe('1');
    });

    it.each([
      ['itself', 2, 2],
      ['its child', 2, 3],
      ['its deepest descendant', 2, 4],
      ['a unit when it is the root', 1, 5],
    ])('refuses a move of unit %s under %s with UNIT_CYCLE and leaves the tree untouched', async (_label, moving, target) => {
      const before = await rowsOf(TENANT_A);
      const error = await failure(inTx((tx) => moveUnit(tx, unitId(moving), unitId(target), null)));
      expect(error).toMatchObject({ code: 'UNIT_CYCLE', status: 422 });
      expect(await rowsOf(TENANT_A)).toEqual(before);
    });

    it('refuses a move that would push a descendant past depth 8 with UNIT_DEPTH_EXCEEDED', async () => {
      // chain: 5 -> x1 -> x2 -> x3 -> x4 -> x5 -> x6 (depth 7); moving the 3-deep subtree of unit 2 under x6 reaches depth 11
      let parent = unitId(5);
      let deepest = parent;
      for (let level = 1; level <= 6; level += 1) {
        const created = await inTx((tx) => createUnit(tx, { ...input(`X${level}`, 1), parentId: parent }));
        parent = created.id;
        deepest = created.id;
      }
      const before = await rowsOf(TENANT_A);
      const error = await failure(inTx((tx) => moveUnit(tx, unitId(2), deepest, null)));
      expect(error).toMatchObject({ code: 'UNIT_DEPTH_EXCEEDED', status: 422 });
      expect(await rowsOf(TENANT_A)).toEqual(before);
    });

    it('refuses a move under a parent that starts after the unit with UNIT_VALIDITY_INVALID', async () => {
      await harness.owner(TENANT_A, [["update machvon.organization_unit set valid_from = date '2026-06-01' where id = $1", [unitId(5)]]]);
      const error = await failure(inTx((tx) => moveUnit(tx, unitId(2), unitId(5), null)));
      expect(error.code).toBe('UNIT_VALIDITY_INVALID');
    });

    it('answers VERSION_CONFLICT for a stale If-Match and RESOURCE_NOT_FOUND for unknown units', async () => {
      await inTx((tx) => updateUnit(tx, unitId(2), { name: 'Bumped' }, 1));
      expect(await failure(inTx((tx) => moveUnit(tx, unitId(2), unitId(5), 1)))).toMatchObject({ code: 'VERSION_CONFLICT' });
      expect(await failure(inTx((tx) => moveUnit(tx, '00000000-0000-4000-8000-0000000000ff', unitId(5), null)))).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
      expect(await failure(inTx((tx) => moveUnit(tx, unitId(2), '00000000-0000-4000-8000-0000000000ff', null)))).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    });

    it('leaves every old path when the transaction fails after the move', async () => {
      const before = await rowsOf(TENANT_A);
      await expect(
        inTx(async (tx) => {
          await moveUnit(tx, unitId(2), unitId(5), null);
          throw new Error('business failure after the move');
        }),
      ).rejects.toThrow('business failure');
      expect(await rowsOf(TENANT_A)).toEqual(before);
    });

    it('commits exactly one of two opposing concurrent moves and refuses the other with UNIT_CYCLE', async () => {
      for (let round = 0; round < 4; round += 1) {
        await seedTree();
        const settled = await Promise.allSettled([
          inTx((tx) => moveUnit(tx, unitId(2), unitId(5), null)),
          inTx((tx) => moveUnit(tx, unitId(5), unitId(2), null)),
        ]);
        const fulfilled = settled.filter((result) => result.status === 'fulfilled');
        const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.reason).toMatchObject({ code: 'UNIT_CYCLE' });
        const rows = await rowsOf(TENANT_A);
        for (const row of rows) {
          const parent = rows.find((candidate) => candidate.id === row.parent_id);
          expect(row.path).toBe(`${parent?.path ?? '/'}${row.id}/`);
        }
      }
    }, 60_000);
  });
});
