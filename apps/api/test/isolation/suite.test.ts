import { TENANT_IDS, UNIT_FIXTURES, runIsolationSuite } from './suite';
import type { IsolationChannel } from './suite';

const NOT_FOUND = { status: 404, body: '{"code":"RESOURCE_NOT_FOUND"}' };
const OWN_LIST = { status: 200, body: JSON.stringify(UNIT_FIXTURES['TNT-A'].map((unit) => unit.name)) };

function channel(overrides: Partial<IsolationChannel> = {}): IsolationChannel {
  return {
    name: 'fake',
    seed: async () => undefined,
    readAs: async () => NOT_FOUND,
    listAs: async () => OWN_LIST,
    ...overrides,
  };
}

function run(channels: IsolationChannel[], idBearingOperations: string[] = [], cases: string[] = []) {
  return runIsolationSuite({ channels, idBearingOperations, foreignIdCases: new Set(cases) });
}

describe('runIsolationSuite', () => {
  it('passes a channel that hides the foreign object and lists own rows only', async () => {
    await expect(run([channel()])).resolves.toEqual({ ok: true, leaks: [], uncoveredOperations: [] });
  });

  it('seeds both tenants before reading', async () => {
    const seeded: string[] = [];
    await run([channel({ seed: async (tenant) => void seeded.push(tenant) })]);
    expect(seeded).toEqual(['TNT-A', 'TNT-B']);
  });

  it('reports a foreign read that answers anything but 404', async () => {
    const report = await run([channel({ readAs: async () => ({ status: 200, body: '{}' }) })]);
    expect(report.ok).toBe(false);
    expect(report.leaks).toEqual(['fake: foreign id read answered 200 instead of 404']);
  });

  it('reports each kind of TNT-B data in a 404 body without echoing it', async () => {
    const [unit] = UNIT_FIXTURES['TNT-B'];
    const body = JSON.stringify({ detail: `${unit?.name} ${unit?.code} ${unit?.id} ${TENANT_IDS['TNT-B'].toUpperCase()}` });
    const report = await run([channel({ readAs: async () => ({ status: 404, body }) })]);
    expect(report.leaks).toEqual([
      'fake: foreign id read exposes a TNT-B tenant id',
      'fake: foreign id read exposes a TNT-B unit id',
      'fake: foreign id read exposes a TNT-B unit code',
      'fake: foreign id read exposes a TNT-B unit name',
    ]);
    expect(JSON.stringify(report)).not.toContain(unit?.name ?? 'missing');
  });

  it('reports a list that holds TNT-B rows', async () => {
    const body = JSON.stringify([...UNIT_FIXTURES['TNT-A'], ...UNIT_FIXTURES['TNT-B']].map((unit) => unit.name));
    const report = await run([channel({ listAs: async () => ({ status: 200, body }) })]);
    expect(report.leaks).toEqual(['fake: list exposes a TNT-B unit name']);
  });

  it('reports a list that is not 200 or misses own rows', async () => {
    const report = await run([channel({ listAs: async () => ({ status: 500, body: '[]' }) })]);
    expect(report.leaks).toEqual([
      'fake: list answered 500 instead of 200',
      ...UNIT_FIXTURES['TNT-A'].map((unit) => `fake: list misses own unit ${unit.code}`),
    ]);
  });

  it('skips the list check for a channel without listAs', async () => {
    const report = await run([channel({ listAs: undefined })]);
    expect(report.ok).toBe(true);
  });

  it('fails when an implemented id-bearing operation has no registered foreign-id case (AC-ST-KERNEL-026-3)', async () => {
    const report = await run([channel()], ['getA', 'getB'], ['getA']);
    expect(report).toEqual({ ok: false, leaks: [], uncoveredOperations: ['getB'] });
  });

  describe('an attempt that must come back empty', () => {
    const attemptsOf = (body: string): Partial<IsolationChannel> => ({
      foreignAttempts: async () => [{ operation: 'lost', status: 200, body, expectedStatuses: [200], mustBeEmpty: true }],
    });

    it('passes an empty page and reports rows of the creator tenant, which are not empty either', async () => {
      await expect(run([channel(attemptsOf('{"items":[],"status":"FAILED"}'))])).resolves.toEqual({ ok: true, leaks: [], uncoveredOperations: [] });
      const report = await run([channel(attemptsOf(JSON.stringify({ items: [{ name: UNIT_FIXTURES['TNT-A'][0]?.name }], status: 'DONE' })))]);
      expect(report.leaks).toEqual(['fake: foreign id lost did not come back empty']);
    });
  });

  describe('a channel whose safe answer is an empty page', () => {
    const EMPTY = { status: 200, body: '{"items":[],"next_cursor":null}' };

    it('passes an empty page for the foreign read', async () => {
      await expect(run([channel({ foreignReadOutcome: 'empty', readAs: async () => EMPTY })])).resolves.toEqual({ ok: true, leaks: [], uncoveredOperations: [] });
    });

    it('does not accept 404 where an empty page is the contract, and reports a page with items or one that is not a page', async () => {
      expect((await run([channel({ foreignReadOutcome: 'empty', readAs: async () => NOT_FOUND })])).leaks).toEqual(['fake: foreign read answered 404 instead of 200']);
      const [unit] = UNIT_FIXTURES['TNT-B'];
      const withItems = { status: 200, body: JSON.stringify({ items: [{ title: unit?.name }] }) };
      expect((await run([channel({ foreignReadOutcome: 'empty', readAs: async () => withItems })])).leaks).toEqual([
        'fake: foreign read did not come back empty',
        'fake: foreign id read exposes a TNT-B unit name',
      ]);
      for (const body of ['not json', '{}', '{"items":"none"}', 'null']) {
        expect((await run([channel({ foreignReadOutcome: 'empty', readAs: async () => ({ status: 200, body }) })])).leaks).toEqual(['fake: foreign read did not come back empty']);
      }
    });

    it('still demands 404 from a channel that does not say otherwise', async () => {
      expect((await run([channel({ readAs: async () => EMPTY })])).leaks).toEqual(['fake: foreign id read answered 200 instead of 404']);
    });
  });

  it('names the channel in each violation across several channels', async () => {
    const report = await run([channel({ name: 'one' }), channel({ name: 'two', readAs: async () => ({ status: 200, body: '' }) })]);
    expect(report.leaks).toEqual(['two: foreign id read answered 200 instead of 404']);
  });
});
