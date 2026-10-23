import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORD_PATH = join(REPO_ROOT, '.test-locks', 'shared-db.json');
const STATE_KEY = '__MACHVON_SHARED_TEST_DATABASE__';
const SHARED_ENV = 'MACHVON_SHARED_DB';

/**
 * Stops the shared server, removes the run record, forgets the connection record in the environment and releases the
 * `db` lane. Without the environment step a later setup in the same process (watch mode) would take the stale value for
 * an outer run's server and start no PostgreSQL. The parameters exist for tests; the default export uses the real ones.
 */
export async function teardownShared({ state, env = process.env, recordPath = RECORD_PATH, remove = (path) => rmSync(path, { force: true }) }) {
  if (state === undefined) return;
  try {
    await state.shared.stop();
  } finally {
    remove(recordPath);
    // Only a record this setup wrote itself: an outer run's value is not ours to clear.
    if (env[SHARED_ENV] === JSON.stringify(state.shared.info.record)) delete env[SHARED_ENV];
    state.handle.release();
  }
}

/** Jest global teardown (see jest.global-setup.mjs). */
export default async function globalTeardown() {
  const state = globalThis[STATE_KEY];
  if (state === undefined) return;
  try {
    await teardownShared({ state });
  } finally {
    delete globalThis[STATE_KEY];
  }
}
