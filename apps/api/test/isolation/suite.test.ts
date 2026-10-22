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

  it('fails when an implemented id-bearing operation has no registered foreign-id case', async () => {
    const report = await run([channel()], ['getA', 'getB'], ['getA']);
    expect(report).toEqual({ ok: false, leaks: [], uncoveredOperations: ['getB'] });
  });

  it('names the channel in each violation across several channels', async () => {
    const report = await run([channel({ name: 'one' }), channel({ name: 'two', readAs: async () => ({ status: 200, body: '' }) })]);
    expect(report.leaks).toEqual(['two: foreign id read answered 200 instead of 404']);
  });
});
