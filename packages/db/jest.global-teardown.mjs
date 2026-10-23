import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORD_PATH = join(REPO_ROOT, '.test-locks', 'shared-db.json');
const STATE_KEY = '__MACHVON_SHARED_TEST_DATABASE__';

/** Stops the shared server, removes the run record and releases the `db` lane (see jest.global-setup.mjs). */
export default async function globalTeardown() {
  const state = globalThis[STATE_KEY];
  if (state === undefined) return;
  try {
    await state.shared.stop();
  } finally {
    rmSync(RECORD_PATH, { force: true });
    state.handle.release();
    delete globalThis[STATE_KEY];
  }
}
