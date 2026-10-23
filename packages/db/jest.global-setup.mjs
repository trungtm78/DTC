import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLane } from '../../scripts/lane.mjs';

/**
 * Jest global setup of every package that runs database suites (packages/db, apps/api). It holds the `db` lane for
 * the whole run (one database-backed run at a time on the machine), removes what an interrupted earlier run left
 * behind, and starts ONE PostgreSQL server with the migrated template that all suites clone.
 *
 * MACHVON_TEST_LANE=unit starts nothing (suites that need a database then start a server of their own);
 * MACHVON_SHARED_DB=off does the same explicitly. The default lane is `db`.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORD_PATH = join(REPO_ROOT, '.test-locks', 'shared-db.json');
const TEMP_PREFIX = 'machvon-pg-shared-';
const SHARED_ENV = 'MACHVON_SHARED_DB';
const LANE_ENV = 'MACHVON_TEST_LANE';
const STATE_KEY = '__MACHVON_SHARED_TEST_DATABASE__';

function powershell(script) {
  return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
}

function readRecord() {
  if (!existsSync(RECORD_PATH)) return undefined;
  try {
    const record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
    return Number.isInteger(record.runnerPid) && Number.isFinite(record.writtenAt) ? record : undefined;
  } catch {
    // A half written record is treated as absent.
    return undefined;
  }
}

function inspect(pid) {
  if (process.platform === 'win32') {
    const out = powershell(
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { [pscustomobject]@{ pid = $p.ProcessId; commandLine = [string]$p.CommandLine; startedAt = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`,
    );
    return out === '' ? undefined : JSON.parse(out);
  }
  try {
    // Linux and Windows are the supported hosts: `ps -o etimes` (elapsed seconds) does not exist on macOS.
    const out = execFileSync('ps', ['-o', 'etimes=,args=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const match = /^(\d+)\s+(.*)$/.exec(out);
    return match === null ? undefined : { pid, commandLine: match[2] ?? '', startedAt: Date.now() - Number(match[1]) * 1000 };
  } catch {
    // ps exits non-zero when no process has that pid.
    return undefined;
  }
}

function listPostgres() {
  if (process.platform === 'win32') {
    const out = powershell(
      "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; commandLine = [string]$_.CommandLine } } | ConvertTo-Json -Compress",
    );
    if (out === '') return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  const out = execFileSync('ps', ['-eo', 'pid=,comm=,args='], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null && match[2] === 'postgres')
    .map((match) => ({ pid: Number(match[1]), name: match[2], commandLine: match[3] }));
}

function kill(pid) {
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(pid, 'SIGKILL');
}

export default async function globalSetup() {
  const lane = process.env[LANE_ENV] ?? 'db';
  if (lane === 'unit' || process.env[SHARED_ENV] === 'off') return;
  if (process.env[SHARED_ENV] !== undefined && process.env[SHARED_ENV] !== '') return; // an outer run already shares a server

  const handle = await acquireLane('db', { log: (line) => process.stderr.write(`${line}\n`) });
  try {
    const { cleanLeftovers } = await import('./src/test-hygiene.ts');
    const { startSharedDatabase } = await import('./src/template-database.ts');
    mkdirSync(dirname(RECORD_PATH), { recursive: true });
    cleanLeftovers({
      repoRoot: REPO_ROOT,
      tempPrefix: TEMP_PREFIX,
      readRecord,
      inspect,
      listPostgres,
      kill,
      discard: () => rmSync(RECORD_PATH, { force: true }),
      report: (message) => process.stderr.write(`test hygiene: ${message}\n`),
    });
    const shared = await startSharedDatabase(REPO_ROOT, { tempPrefix: TEMP_PREFIX });
    writeFileSync(RECORD_PATH, JSON.stringify({ runnerPid: process.pid, writtenAt: Date.now(), port: shared.info.port }));
    process.env[SHARED_ENV] = JSON.stringify(shared.info.record);
    globalThis[STATE_KEY] = { shared, handle };
  } catch (error) {
    handle.release();
    throw error;
  }
}
