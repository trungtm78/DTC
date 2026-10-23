import { canonicalJson, sha256Hex } from '../src/canonical-json.ts';
import type { EffectiveAccess } from '../src/effective-access.ts';
import { runScheduledExport } from '../src/scheduled-export.ts';
import type { ScheduledExportDeps, ScheduledExportJob } from '../src/scheduled-export.ts';

const NOW = new Date('2026-06-01T10:00:00Z');
const MEMBER = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const UNIT_1 = '00000000-0000-4000-a001-000000000001';
const UNIT_2 = '00000000-0000-4000-a001-000000000002';
const UNIT_3 = '00000000-0000-4000-a001-000000000003';
const PERMISSION = 'report.export';

const accessWith = (permissions: string[], overrides: Partial<EffectiveAccess> = {}): EffectiveAccess => ({
  membershipId: MEMBER,
  scopeVersion: 1,
  membershipActive: true,
  grants: [{ roleCode: 'EXPORTER', rank: 50, permissions, scope: { kind: 'TENANT' }, status: 'Active', effectiveFrom: new Date(0), effectiveUntil: null }],
  ...overrides,
});

const job = (unitIds: string[]): ScheduledExportJob => ({ id: 'job-1', createdBy: MEMBER, permission: PERMISSION, unitIds });

interface Harness {
  deps: ScheduledExportDeps<string>;
  produced: Array<readonly string[]>;
}

function harness(access: EffectiveAccess, reachable: string[]): Harness {
  const produced: Array<readonly string[]> = [];
  return {
    produced,
    deps: {
      now: () => NOW,
      loadAccess: () => Promise.resolve(access),
      reachableUnitIds: () => Promise.resolve(reachable),
      produce: (unitIds) => {
        produced.push(unitIds);
        return Promise.resolve(unitIds.map((unitId) => `row:${unitId}`));
      },
    },
  };
}

describe('scheduled export re-authorisation (ST-KERNEL-025)', () => {
  it('exports the units of the job that the creator still reaches, with a hash of exactly that scope', async () => {
    const { deps, produced } = harness(accessWith([PERMISSION]), [UNIT_1, UNIT_2, UNIT_3]);
    const outcome = await runScheduledExport(job([UNIT_2, UNIT_1]), deps);
    expect(outcome).toEqual({
      status: 'DONE',
      rows: [`row:${UNIT_1}`, `row:${UNIT_2}`],
      unitIds: [UNIT_1, UNIT_2],
      narrowed: false,
      scopeHash: sha256Hex(canonicalJson({ unitIds: [UNIT_1, UNIT_2] })),
    });
    expect(produced).toEqual([[UNIT_1, UNIT_2]]);
  });

  it('keeps only the intersection when a unit was revoked, and records another scope hash (AC-ST-KERNEL-025-2)', async () => {
    const before = await runScheduledExport(job([UNIT_1, UNIT_2]), harness(accessWith([PERMISSION]), [UNIT_1, UNIT_2]).deps);
    const after = await runScheduledExport(job([UNIT_1, UNIT_2]), harness(accessWith([PERMISSION]), [UNIT_1, UNIT_3]).deps);
    expect(after).toMatchObject({ status: 'DONE', unitIds: [UNIT_1], rows: [`row:${UNIT_1}`], narrowed: true });
    expect(after.status === 'DONE' && before.status === 'DONE' && after.scopeHash !== before.scopeHash).toBe(true);
  });

  it('never widens: a unit the creator gained after the job was made is not exported', async () => {
    const outcome = await runScheduledExport(job([UNIT_1]), harness(accessWith([PERMISSION]), [UNIT_1, UNIT_2, UNIT_3]).deps);
    expect(outcome).toMatchObject({ status: 'DONE', unitIds: [UNIT_1], narrowed: false });
  });

  it('fails closed, producing nothing, when the creator no longer holds the permission', async () => {
    const { deps, produced } = harness(accessWith(['report.read']), [UNIT_1]);
    expect(await runScheduledExport(job([UNIT_1]), deps)).toEqual({ status: 'FAILED', code: 'SCOPE_DENIED', reason: 'PERMISSION_LOST' });
    expect(produced).toEqual([]);
  });

  it('fails closed when the membership is no longer active or the grant has expired', async () => {
    const inactive = harness(accessWith([PERMISSION], { membershipActive: false }), [UNIT_1]);
    expect(await runScheduledExport(job([UNIT_1]), inactive.deps)).toMatchObject({ status: 'FAILED', reason: 'PERMISSION_LOST' });
    const expired = accessWith([PERMISSION]);
    const lapsed = harness({ ...expired, grants: [{ ...(expired.grants[0] as EffectiveAccess['grants'][number]), effectiveUntil: new Date(NOW.getTime() - 1) }] }, [UNIT_1]);
    expect(await runScheduledExport(job([UNIT_1]), lapsed.deps)).toMatchObject({ status: 'FAILED', reason: 'PERMISSION_LOST' });
    expect(inactive.produced).toEqual([]);
    expect(lapsed.produced).toEqual([]);
  });

  it('fails closed, producing nothing, when none of the units of the job is reachable any more or the job names none', async () => {
    const gone = harness(accessWith([PERMISSION]), [UNIT_3]);
    expect(await runScheduledExport(job([UNIT_1, UNIT_2]), gone.deps)).toEqual({ status: 'FAILED', code: 'SCOPE_DENIED', reason: 'NO_UNIT_IN_SCOPE' });
    const none = harness(accessWith([PERMISSION]), [UNIT_1]);
    expect(await runScheduledExport(job([]), none.deps)).toMatchObject({ status: 'FAILED', reason: 'NO_UNIT_IN_SCOPE' });
    expect(gone.produced).toEqual([]);
    expect(none.produced).toEqual([]);
  });

  it('counts a unit named twice in the job once', async () => {
    const outcome = await runScheduledExport(job([UNIT_1, UNIT_1, UNIT_2]), harness(accessWith([PERMISSION]), [UNIT_1]).deps);
    expect(outcome).toMatchObject({ status: 'DONE', unitIds: [UNIT_1], narrowed: true });
  });
});
