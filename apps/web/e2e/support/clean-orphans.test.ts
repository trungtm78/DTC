import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanOrphans, isStackProcess } from './clean-orphans.ts';
import type { CleanupDeps, ProcessInfo, StackRecord } from './clean-orphans.ts';
import type { ProcessEntry } from './orphans.ts';

const ROOT = 'C:/PIS';
const PREFIX = 'machvon-e2e-pg-';
const WRITTEN_AT = 1_000_000;
const OWN_BIN = '"C:/PIS/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe"';
const STACK_COMMAND = 'node jest.js --runInBand --testMatch "<rootDir>/test/e2e-stack/serve.stack.ts"';
const server = (pid: number, bin = OWN_BIN): ProcessEntry => ({ pid, name: 'postgres.exe', commandLine: `${bin} -D C:/Temp/${PREFIX}${pid}/data` });

interface World {
  record?: StackRecord;
  running: Map<number, ProcessInfo>;
  postgres: ProcessEntry[];
  killed: number[];
  discarded: number;
  killFails: Set<number>;
}

function world(init: Partial<World> = {}): { deps: CleanupDeps; state: World; errors: string[] } {
  const state: World = { running: new Map(), postgres: [], killed: [], discarded: 0, killFails: new Set(), ...init };
  const errors: string[] = [];
  const deps: CleanupDeps = {
    repoRoot: ROOT,
    tempPrefix: PREFIX,
    readRecord: () => state.record,
    inspect: (pid) => state.running.get(pid),
    listPostgres: () => state.postgres,
    kill: (pid) => {
      if (state.killFails.has(pid)) throw new Error('access denied');
      state.killed.push(pid);
      state.running.delete(pid);
    },
    discard: () => {
      state.discarded += 1;
    },
    report: (message) => void errors.push(message),
  };
  return { deps, state, errors };
}

test('a live process that is the stack of this record is stopped, then the leftover servers of this workspace', () => {
  const { deps, state } = world({
    record: { pid: 50, writtenAt: WRITTEN_AT },
    running: new Map([[50, { pid: 50, commandLine: STACK_COMMAND, startedAt: WRITTEN_AT - 5_000 }]]),
    postgres: [server(60), server(61)],
  });
  assert.deepEqual(cleanOrphans(deps), { stackPid: 50, servers: [60, 61] });
  assert.deepEqual(state.killed, [50, 60, 61]);
  assert.equal(state.discarded, 1);
});

test('a reused pid (another program) is never killed and its record is discarded', () => {
  const { deps, state } = world({
    record: { pid: 50, writtenAt: WRITTEN_AT },
    running: new Map([[50, { pid: 50, commandLine: 'C:/Program Files/Other/editor.exe', startedAt: WRITTEN_AT - 5_000 }]]),
  });
  assert.deepEqual(cleanOrphans(deps), { servers: [] });
  assert.deepEqual(state.killed, []);
  assert.equal(state.discarded, 1);
});

test('a process that started after the record was written cannot be the one that wrote it', () => {
  const { deps, state } = world({
    record: { pid: 50, writtenAt: WRITTEN_AT },
    running: new Map([[50, { pid: 50, commandLine: STACK_COMMAND, startedAt: WRITTEN_AT + 600_000 }]]),
  });
  assert.deepEqual(cleanOrphans(deps), { servers: [] });
  assert.deepEqual(state.killed, []);
});

test('a process whose start time is unknown is not trusted', () => {
  assert.equal(isStackProcess({ pid: 1, commandLine: STACK_COMMAND }, { pid: 1, writtenAt: WRITTEN_AT }), false);
  assert.equal(isStackProcess({ pid: 1, commandLine: STACK_COMMAND, startedAt: WRITTEN_AT }, { pid: 1, writtenAt: WRITTEN_AT }), true);
});

test('a dead runner leaves only its servers to clean, and a missing record is fine', () => {
  const dead = world({ record: { pid: 50, writtenAt: WRITTEN_AT }, postgres: [server(60)] });
  assert.deepEqual(cleanOrphans(dead.deps), { servers: [60] });
  const none = world({ postgres: [server(61)] });
  assert.deepEqual(cleanOrphans(none.deps), { servers: [61] });
  assert.equal(none.state.discarded, 1);
});

test('servers of another checkout are left alone', () => {
  const { deps, state } = world({
    postgres: [server(60), server(70, '"C:/OTHER/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe"')],
  });
  assert.deepEqual(cleanOrphans(deps), { servers: [60] });
  assert.deepEqual(state.killed, [60]);
});

test('no server is stopped while the runner is still alive after the attempt to stop it', () => {
  const { deps, state, errors } = world({
    record: { pid: 50, writtenAt: WRITTEN_AT },
    running: new Map([[50, { pid: 50, commandLine: STACK_COMMAND, startedAt: WRITTEN_AT - 1 }]]),
    postgres: [server(60)],
    killFails: new Set([50]),
  });
  assert.deepEqual(cleanOrphans(deps), { servers: [] });
  assert.deepEqual(state.killed, []);
  assert.equal(state.discarded, 0);
  assert.match(errors.join('\n'), /still running/);
});

test('a server that cannot be stopped is reported and the others are still stopped', () => {
  const { deps, state, errors } = world({ postgres: [server(60), server(61)], killFails: new Set([60]) });
  assert.deepEqual(cleanOrphans(deps), { servers: [61] });
  assert.deepEqual(state.killed, [61]);
  assert.match(errors.join('\n'), /could not stop leftover server 60: access denied/);
});
