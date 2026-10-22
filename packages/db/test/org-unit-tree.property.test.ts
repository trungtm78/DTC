import * as fc from 'fast-check';
import { DomainError } from '@machvon/kernel';
import { MAX_UNIT_DEPTH, moveUnit } from '../src/org-unit-tree';
import { AuthzHarness, TENANT_A, contextFor, memberId, unitId } from './support/authz-fixtures';

const harness = new AuthzHarness();
const ctx = contextFor(TENANT_A, memberId(1));

/** In-memory model of one tree: parent index per unit (the root has -1). */
interface Model {
  parents: number[];
}

function depthOf(model: Model, index: number): number {
  let depth = 0;
  for (let cursor = model.parents[index] ?? -1; cursor !== -1; cursor = model.parents[cursor] ?? -1) depth += 1;
  return depth;
}

function inSubtree(model: Model, root: number, candidate: number): boolean {
  for (let cursor = candidate; cursor !== -1; cursor = model.parents[cursor] ?? -1) if (cursor === root) return true;
  return false;
}

function subtreeOf(model: Model, root: number): number[] {
  return model.parents.map((_, index) => index).filter((index) => inSubtree(model, root, index));
}

/** Expected outcome of a move under BR-IAM-09, derived from the model alone. */
function expectedOutcome(model: Model, unit: number, target: number): 'CYCLE' | 'DEPTH' | 'NOOP' | 'OK' {
  if (inSubtree(model, unit, target)) return 'CYCLE';
  if (model.parents[unit] === target) return 'NOOP';
  const delta = depthOf(model, target) + 1 - depthOf(model, unit);
  const deepest = Math.max(...subtreeOf(model, unit).map((index) => depthOf(model, index)));
  return deepest + delta > MAX_UNIT_DEPTH ? 'DEPTH' : 'OK';
}

const treeArbitrary = fc
  .integer({ min: 3, max: 14 })
  .chain((size) =>
    fc.tuple(
      fc.constant(size),
      fc.array(fc.nat(), { minLength: size - 1, maxLength: size - 1 }),
      fc.array(fc.tuple(fc.nat(), fc.nat()), { minLength: 1, maxLength: 10 }),
    ),
  )
  .map(([size, picks, moves]) => {
    // Two chains below the root (odd and even indexes) keep trees deep, so some moves reach the depth limit; a
    // few picks attach to a random unit instead, which gives branching.
    const parents = [-1];
    const depths = [0];
    for (let index = 1; index < size; index += 1) {
      const raw = picks[index - 1] ?? 0;
      const chainPrevious = index <= 2 ? 0 : index - 2;
      const eligible = parents.map((_, candidate) => candidate).filter((candidate) => (depths[candidate] ?? 0) < MAX_UNIT_DEPTH);
      const pick = raw % 5 === 0 || !eligible.includes(chainPrevious) ? (eligible[raw % eligible.length] ?? 0) : chainPrevious;
      parents.push(pick);
      depths.push((depths[pick] ?? 0) + 1);
    }
    // The first two moves put the head of one chain under the tail of the other.
    const forced: Array<readonly [number, number]> = [
      [1, size - 1 - ((size - 1) % 2 === 1 ? 1 : 0)],
      [2, size - 1 - ((size - 1) % 2 === 0 ? 1 : 0)],
    ];
    return { model: { parents } as Model, moves: [...forced, ...moves.map(([unit, target]) => [unit % size, target % size] as const)] };
  });

function pathOf(model: Model, index: number, ids: readonly string[]): string {
  const chain: string[] = [];
  for (let cursor = index; cursor !== -1; cursor = model.parents[cursor] ?? -1) chain.unshift(ids[cursor] ?? '');
  return `/${chain.join('/')}/`;
}

describe('organisation unit tree (property)', () => {
  let run = 0;
  const seen = { CYCLE: 0, DEPTH: 0, NOOP: 0, OK: 0 };

  beforeAll(async () => {
    await harness.start();
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  }, 60_000);

  it('keeps every path, depth and parent consistent under random valid and invalid moves, and refuses exactly the invalid ones', async () => {
    await fc.assert(
      fc.asyncProperty(treeArbitrary, async ({ model, moves }) => {
        run += 1;
        const base = 1000 + run * 100;
        const ids = model.parents.map((_, index) => unitId(base + index));
        await harness.seedUnits(
          TENANT_A,
          model.parents.map((parent, index) => ({
            n: base + index,
            path: pathOf(model, index, ids),
            parent: parent === -1 ? undefined : base + parent,
          })),
        );

        for (const [unit, target] of moves) {
          const expected = expectedOutcome(model, unit, target);
          const before = await snapshot(ids);
          let outcome: 'CYCLE' | 'DEPTH' | 'NOOP' | 'OK';
          try {
            const result = await harness.tenants.withTenant(ctx, (tx) => moveUnit(tx, ids[unit] ?? '', ids[target] ?? '', null));
            outcome = result.affectedUnitIds.length === 0 ? 'NOOP' : 'OK';
          } catch (error) {
            if (!(error instanceof DomainError)) throw error;
            outcome = error.code === 'UNIT_CYCLE' ? 'CYCLE' : 'DEPTH';
          }
          expect(outcome).toBe(expected);
          seen[outcome] += 1;
          if (outcome === 'OK') model.parents[unit] = target;
          else expect(await snapshot(ids)).toEqual(before);

          const rows = await snapshot(ids);
          for (const [index, row] of rows.entries()) {
            expect(row.path).toBe(pathOf(model, index, ids));
            expect(row.depth).toBe(depthOf(model, index));
            expect(row.depth).toBeLessThanOrEqual(MAX_UNIT_DEPTH);
            expect(row.parent_id).toBe(model.parents[index] === -1 ? null : ids[model.parents[index] ?? 0]);
          }
        }
      }),
      { numRuns: 20 },
    );
    // The generator must exercise both the accepted and the refused paths.
    expect(seen.OK).toBeGreaterThan(0);
    expect(seen.CYCLE).toBeGreaterThan(0);
    expect(seen.DEPTH).toBeGreaterThan(0);
  }, 240_000);

  async function snapshot(ids: readonly string[]): Promise<Array<{ path: string; depth: number; parent_id: string | null }>> {
    const rows = await harness.owner<{ id: string; path: string; depth: number; parent_id: string | null }>(TENANT_A, [
      ['select id, path, depth, parent_id from machvon.organization_unit where id = any($1::uuid[])', [ids]],
    ]);
    return ids.map((id) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined) throw new Error('unit vanished');
      return { path: row.path, depth: row.depth, parent_id: row.parent_id };
    });
  }
});
