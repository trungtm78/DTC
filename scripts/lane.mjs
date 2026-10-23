import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_LOCALE = 'vi';
const LOCK_DIR = '.test-locks';
const HOLDER_FILE = 'holder.json';
const DEFAULT_STALE_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 250;
const WAITING_REPORT_MS = 30 * 1000;
const HOLDER_GRACE_MS = 2_000;
export const HELD_ENV = 'MACHVON_LANE_HELD';

/**
 * Lanes serialise the heavy test runs of this machine: `db` for suites that start PostgreSQL, `browser` for
 * Playwright, `verify` for the full gate set before a push. Light unit tests do not use a lane.
 */
export const LANES = new Set(['db', 'browser', 'verify']);

function loadMessages(locale) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, 'messages', `${locale}.json`), 'utf8'));
}

function format(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error.code === 'EPERM';
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A file that is missing or half written is treated as absent; the next poll sees the final state.
    return undefined;
  }
}

function removeTree(path) {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

/**
 * The lock is stale when its holder is gone, or it was taken longer ago than `staleMs` (a hung run). A lock directory
 * that has no holder file yet is a caller between mkdir and its first write: it only counts as stale after two seconds.
 */
function lockIsStale(lockPath, staleMs, now) {
  const holder = readJson(join(lockPath, HOLDER_FILE));
  if (holder === undefined) return now() - statSync(lockPath).mtimeMs > HOLDER_GRACE_MS;
  return !isAlive(holder.pid) || now() - holder.startedAt > staleMs;
}

function liveTickets(queuePath) {
  if (!existsSync(queuePath)) return [];
  const live = [];
  for (const name of readdirSync(queuePath).sort()) {
    const ticket = readJson(join(queuePath, name));
    // A ticket of a dead process never gets its turn: drop it so it cannot block the queue.
    if (ticket === undefined || !isAlive(ticket.pid)) {
      rmSync(join(queuePath, name), { force: true });
      continue;
    }
    live.push(name);
  }
  return live;
}

/**
 * Takes the lane and returns a handle whose `release()` frees it (more than once is harmless). Callers are served first
 * in, first out; a lock whose holder died (or that is older than `staleMs`) is reclaimed. When an ancestor process
 * already holds the lane (`MACHVON_LANE_HELD`), nothing is taken and the handle has `held: false`.
 */
export async function acquireLane(lane, options = {}) {
  const {
    root = REPO_ROOT,
    staleMs = DEFAULT_STALE_MS,
    pollMs = DEFAULT_POLL_MS,
    timeoutMs,
    locale = DEFAULT_LOCALE,
    log = console.log,
    now = Date.now,
    env = process.env,
  } = options;
  const messages = loadMessages(locale);
  if (!LANES.has(lane)) throw new Error(format(messages['lane.unknown'], { lane }));
  if (env[HELD_ENV] === lane) return { held: false, release: () => undefined };

  const locksRoot = join(root, LOCK_DIR);
  const lockPath = join(locksRoot, `${lane}.lock`);
  const queuePath = join(locksRoot, `${lane}.queue`);
  mkdirSync(queuePath, { recursive: true });
  const ticketName = `${String(now()).padStart(15, '0')}-${process.pid}-${randomBytes(3).toString('hex')}`;
  const ticketPath = join(queuePath, ticketName);
  writeFileSync(ticketPath, JSON.stringify({ pid: process.pid, queuedAt: now() }));

  const startedWaiting = now();
  let lastReport = startedWaiting;
  try {
    for (;;) {
      const queue = liveTickets(queuePath);
      if (queue[0] === ticketName) {
        if (existsSync(lockPath) && lockIsStale(lockPath, staleMs, now)) {
          log(format(messages['lane.stale'], { lane }));
          removeTree(lockPath);
        }
        try {
          mkdirSync(lockPath);
          writeFileSync(join(lockPath, HOLDER_FILE), JSON.stringify({ pid: process.pid, startedAt: now() }));
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      if (timeoutMs !== undefined && now() - startedWaiting > timeoutMs) {
        throw new Error(format(messages['lane.timeout'], { lane, seconds: Math.round((now() - startedWaiting) / 1000) }));
      }
      if (now() - lastReport > WAITING_REPORT_MS) {
        lastReport = now();
        log(format(messages['lane.waiting'], { lane, position: Math.max(1, queue.indexOf(ticketName) + 1) }));
      }
      await wait(pollMs);
    }
  } finally {
    rmSync(ticketPath, { force: true });
  }
  let released = false;
  return {
    held: true,
    release() {
      if (released) return;
      released = true;
      removeTree(lockPath);
    },
  };
}

/**
 * Runs `work` while holding the lane; `work` returns the exit code, which is returned. The lane is released when the
 * work ends or throws.
 */
export async function runInLane(lane, work, options = {}) {
  const handle = await acquireLane(lane, options);
  try {
    return await work();
  } finally {
    handle.release();
  }
}

/** `node scripts/lane.mjs <lane> -- <command> [args]`: runs the command under the lane and passes its exit code on. */
export async function main(argv, { root = REPO_ROOT, log = console.log, locale = DEFAULT_LOCALE } = {}) {
  const messages = loadMessages(locale);
  const separator = argv.indexOf('--');
  const lane = argv[0];
  if (separator < 1 || separator === argv.length - 1 || !LANES.has(lane)) {
    log(format(messages['lane.usage'], { lanes: [...LANES].join('|') }));
    return 2;
  }
  const [command, ...args] = argv.slice(separator + 1);
  return runInLane(
    lane,
    () =>
      new Promise((resolveRun, rejectRun) => {
        const child = spawn(command, args, {
          stdio: 'inherit',
          // npm ships as npm.cmd on Windows; Node refuses to spawn .cmd files without a shell.
          shell: process.platform === 'win32' && /^(npm|npx|flutter)$/.test(command),
          env: { ...process.env, [HELD_ENV]: lane },
        });
        child.once('error', rejectRun);
        child.once('close', (code) => resolveRun(code ?? 1));
      }),
    { root, log, locale },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
