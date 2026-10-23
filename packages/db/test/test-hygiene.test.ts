import { cleanLeftovers, isRunnerProcess, leftoverServerPids, normalisePath } from '../src/test-hygiene';
import type { HygieneDeps, ProcessEntry, RunRecord } from '../src/test-hygiene';

const REPO = 'C:\\PIS';
const PREFIX = 'machvon-pg-shared-';
const MINE = `"C:/PIS/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe" -D C:/Users/x/AppData/Local/Temp/${PREFIX}AbCd/data -p 5555`;

function entry(pid: number, commandLine: string, name = 'postgres.exe'): ProcessEntry {
  return { pid, name, commandLine };
}

function deps(overrides: Partial<HygieneDeps> & { alive?: Record<number, { commandLine: string; startedAt?: number }> } = {}) {
  const killed: number[] = [];
  const reports: string[] = [];
  let discarded = 0;
  const alive = overrides.alive ?? {};
  const value: HygieneDeps = {
    repoRoot: REPO,
    tempPrefix: PREFIX,
    readRecord: () => undefined,
    inspect: (pid) => (alive[pid] === undefined ? undefined : { pid, ...alive[pid] }),
    listPostgres: () => [],
    kill: (pid) => {
      killed.push(pid);
    },
    discard: () => {
      discarded += 1;
    },
    report: (message) => reports.push(message),
    ...overrides,
  };
  return { value, killed, reports, discarded: () => discarded };
}

describe('leftoverServerPids', () => {
  it('lists only database servers of this repository that run in a directory with the shared prefix', () => {
    const processes = [
      entry(1, MINE),
      entry(2, MINE.replace(PREFIX, 'machvon-pg-other-')),
      entry(3, MINE.replace('C:/PIS', 'C:/OTHER')),
      entry(4, MINE, 'node.exe'),
      entry(5, MINE.replace('postgres.exe', 'POSTGRES.EXE'), 'POSTGRES.EXE'),
    ];
    expect(leftoverServerPids(processes, PREFIX, REPO)).toEqual([1, 5]);
  });

  it('compares paths without regard to slashes, case and a trailing slash', () => {
    expect(normalisePath('C:\\PIS\\')).toBe('c:/pis/');
    expect(normalisePath('c:/pis')).toBe('c:/pis/');
  });
});

describe('isRunnerProcess', () => {
  const record: RunRecord = { runnerPid: 10, writtenAt: 1_000_000 };

  it('accepts a jest process that started before the record was written', () => {
    expect(isRunnerProcess({ pid: 10, commandLine: 'node jest.js --config', startedAt: 999_000 }, record)).toBe(true);
  });

  it('refuses a pid that now belongs to another program, a process that started later, and an unknown start time', () => {
    expect(isRunnerProcess({ pid: 10, commandLine: 'notepad.exe', startedAt: 999_000 }, record)).toBe(false);
    expect(isRunnerProcess({ pid: 10, commandLine: 'node jest.js', startedAt: 2_000_000 }, record)).toBe(false);
    expect(isRunnerProcess({ pid: 10, commandLine: 'node jest.js' }, record)).toBe(false);
  });
});

describe('cleanLeftovers', () => {
  it('stops the servers an interrupted run left behind and discards its record', () => {
    const harness = deps({
      readRecord: () => ({ runnerPid: 10, writtenAt: 1_000_000 }),
      listPostgres: () => [entry(1, MINE), entry(2, MINE.replace(PREFIX, 'machvon-pg-other-'))],
    });
    expect(cleanLeftovers(harness.value)).toEqual({ servers: [1] });
    expect(harness.killed).toEqual([1]);
    expect(harness.discarded()).toBe(1);
  });

  it('leaves everything alone while the runner of the record is still alive', () => {
    const harness = deps({
      readRecord: () => ({ runnerPid: 10, writtenAt: 1_000_000 }),
      alive: { 10: { commandLine: 'node jest.js', startedAt: 900_000 } },
      listPostgres: () => [entry(1, MINE)],
    });
    expect(cleanLeftovers(harness.value)).toEqual({ servers: [], runnerAlive: true });
    expect(harness.killed).toEqual([]);
    expect(harness.discarded()).toBe(0);
    expect(harness.reports.length).toBe(1);
  });

  it('treats a record whose pid was reused by another program as left over', () => {
    const harness = deps({
      readRecord: () => ({ runnerPid: 10, writtenAt: 1_000_000 }),
      alive: { 10: { commandLine: 'chrome.exe', startedAt: 900_000 } },
      listPostgres: () => [entry(1, MINE)],
    });
    expect(cleanLeftovers(harness.value)).toEqual({ servers: [1] });
  });

  it('reports a server it cannot stop and goes on with the others', () => {
    const harness = deps({
      listPostgres: () => [entry(1, MINE), entry(2, MINE)],
      kill: (pid) => {
        if (pid === 1) throw new Error('access denied');
      },
    });
    const result = cleanLeftovers(harness.value);
    expect(result.servers).toEqual([2]);
    expect(harness.reports.some((line) => line.includes('1') && line.includes('access denied'))).toBe(true);
  });

  it('does nothing without a record and without leftover servers, except discarding an absent record', () => {
    const harness = deps();
    expect(cleanLeftovers(harness.value)).toEqual({ servers: [] });
    expect(harness.discarded()).toBe(1);
  });
});
