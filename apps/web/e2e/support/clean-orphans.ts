import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orphanPids } from './orphans.ts';
import type { ProcessEntry } from './orphans.ts';
import { STACK_INFO_PATH, STACK_PID_PATH, STACK_STOP_PATH, STACK_TEMP_PREFIX } from './stack-paths.ts';

/** What the stack runner's command line contains: it is the jest run of apps/api/test/e2e-stack/serve.stack.ts. */
const STACK_COMMAND_MARKER = 'serve.stack.ts';
/** The runner is started before it writes its pid file; clocks and file times are coarse, so allow a little slack. */
const START_SLACK_MS = 5_000;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The pid file of a stack run, with the time it was written (the runner writes it right after it started). */
export interface StackRecord {
  pid: number;
  /** Milliseconds since the epoch. */
  writtenAt: number;
}

export interface ProcessInfo {
  pid: number;
  commandLine: string;
  /** Milliseconds since the epoch; unknown when the platform did not tell. */
  startedAt?: number;
}

/** Everything cleanOrphans touches, so its decisions can be tested without killing anything. */
export interface CleanupDeps {
  repoRoot: string;
  tempPrefix: string;
  readRecord(): StackRecord | undefined;
  /** The running process with that pid, or undefined when there is none. */
  inspect(pid: number): ProcessInfo | undefined;
  listPostgres(): ProcessEntry[];
  /** Stops the process and its children; throws when it cannot. */
  kill(pid: number): void;
  /** Removes the stack's info, stop and pid files. */
  discard(): void;
  report(message: string): void;
}

/**
 * A pid is only the stack runner of this record when the process now holding it was started by the stack command
 * and was running before the record was written. A pid that the system reused for another program fails the first
 * test; a process that started later cannot have written the record. A start time that is unknown is not trusted.
 */
export function isStackProcess(info: ProcessInfo, record: StackRecord): boolean {
  if (!info.commandLine.includes(STACK_COMMAND_MARKER)) return false;
  return info.startedAt !== undefined && info.startedAt <= record.writtenAt + START_SLACK_MS;
}

/**
 * Stops what an earlier, interrupted run of the stack left behind: its runner process tree (only after checking that
 * the pid still is that runner) and then the database servers of this workspace, and only once no runner is alive.
 */
export function cleanOrphans(deps: CleanupDeps): { stackPid?: number; servers: number[] } {
  const result: { stackPid?: number; servers: number[] } = { servers: [] };
  const record = deps.readRecord();
  if (record !== undefined) {
    const info = deps.inspect(record.pid);
    if (info !== undefined && isStackProcess(info, record)) {
      try {
        deps.kill(record.pid);
        result.stackPid = record.pid;
      } catch (error) {
        deps.report(`could not stop the stack runner ${record.pid}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (deps.inspect(record.pid) !== undefined) {
        // The runner may still hold its servers and its files: leave everything as it is.
        deps.report(`the stack runner ${record.pid} is still running; its servers are left alone`);
        return result;
      }
    }
  }
  for (const pid of orphanPids(deps.listPostgres(), deps.tempPrefix, deps.repoRoot)) {
    try {
      deps.kill(pid);
      result.servers.push(pid);
    } catch (error) {
      deps.report(`could not stop leftover server ${pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  deps.discard();
  return result;
}

function readStackRecord(): StackRecord | undefined {
  if (!existsSync(STACK_PID_PATH)) return undefined;
  const pid = Number(readFileSync(STACK_PID_PATH, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  return { pid, writtenAt: statSync(STACK_PID_PATH).mtimeMs };
}

function powershell(script: string): string {
  return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
}

function inspectProcess(pid: number): ProcessInfo | undefined {
  if (process.platform === 'win32') {
    const out = powershell(
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { [pscustomobject]@{ pid = $p.ProcessId; commandLine = [string]$p.CommandLine; startedAt = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`,
    );
    return out === '' ? undefined : (JSON.parse(out) as ProcessInfo);
  }
  try {
    const out = execFileSync('ps', ['-o', 'etimes=,args=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const match = /^(\d+)\s+(.*)$/.exec(out);
    return match === null ? undefined : { pid, commandLine: match[2] ?? '', startedAt: Date.now() - Number(match[1]) * 1000 };
  } catch {
    // ps exits non-zero when no process has that pid.
    return undefined;
  }
}

function killTree(pid: number): void {
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(pid, 'SIGKILL');
}

function listPostgres(): ProcessEntry[] {
  if (process.platform === 'win32') {
    const out = powershell(
      "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; commandLine = [string]$_.CommandLine } } | ConvertTo-Json -Compress",
    );
    if (out === '') return [];
    const parsed: unknown = JSON.parse(out);
    return (Array.isArray(parsed) ? parsed : [parsed]) as ProcessEntry[];
  }
  const out = execFileSync('ps', ['-eo', 'pid=,comm=,args='], { encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ pid: Number(match[1]), name: match[2] ?? '', commandLine: match[3] ?? '' }));
}

export const defaultDeps: CleanupDeps = {
  repoRoot: REPO_ROOT,
  tempPrefix: STACK_TEMP_PREFIX,
  readRecord: readStackRecord,
  inspect: inspectProcess,
  listPostgres,
  kill: killTree,
  discard: () => {
    for (const stale of [STACK_INFO_PATH, STACK_STOP_PATH, STACK_PID_PATH]) rmSync(stale, { force: true });
  },
  report: (message) => void process.stderr.write(`${message}\n`),
};

if (process.argv[1] !== undefined && /clean-orphans\.ts$/.test(process.argv[1])) {
  const cleaned = cleanOrphans(defaultDeps);
  if (cleaned.stackPid !== undefined || cleaned.servers.length > 0) {
    process.stdout.write(`cleaned leftovers of an earlier e2e stack: process ${cleaned.stackPid ?? '-'}, servers ${cleaned.servers.join(',') || '-'}\n`);
  }
}
