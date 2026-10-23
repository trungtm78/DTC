import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teardownShared } from '../packages/db/jest.global-teardown.mjs';

const SHARED_ENV = 'MACHVON_SHARED_DB';

function fakeState(record, events) {
  return {
    shared: {
      info: { record },
      stop: async () => {
        events.push('stop');
      },
    },
    handle: {
      release: () => {
        events.push('release');
      },
    },
  };
}

test('teardown stops the server, removes the run record, clears its own environment record and releases the lane', async () => {
  const events = [];
  const record = { port: 5432, databaseDir: 'x' };
  const env = { [SHARED_ENV]: JSON.stringify(record), OTHER: 'kept' };
  await teardownShared({ state: fakeState(record, events), env, recordPath: 'run.json', remove: (path) => events.push(`remove ${path}`) });
  assert.deepEqual(events, ['stop', 'remove run.json', 'release']);
  assert.equal(SHARED_ENV in env, false, 'a stale shared record would make the next setup start no server');
  assert.equal(env.OTHER, 'kept');
});

test('the environment record of an outer run is not cleared', async () => {
  const events = [];
  const env = { [SHARED_ENV]: JSON.stringify({ port: 1 }) };
  await teardownShared({ state: fakeState({ port: 2 }, events), env, recordPath: 'run.json', remove: () => undefined });
  assert.equal(env[SHARED_ENV], JSON.stringify({ port: 1 }));
});

test('the lane is released and the record removed even when stopping the server fails', async () => {
  const events = [];
  const state = fakeState({ port: 3 }, events);
  state.shared.stop = async () => {
    throw new Error('stop failed');
  };
  const env = { [SHARED_ENV]: JSON.stringify({ port: 3 }) };
  await assert.rejects(teardownShared({ state, env, recordPath: 'run.json', remove: (path) => events.push(`remove ${path}`) }), /stop failed/);
  assert.deepEqual(events, ['remove run.json', 'release']);
  assert.equal(SHARED_ENV in env, false);
});

test('without state there is nothing to tear down', async () => {
  await teardownShared({ state: undefined, env: {}, remove: () => assert.fail('nothing to remove') });
});
