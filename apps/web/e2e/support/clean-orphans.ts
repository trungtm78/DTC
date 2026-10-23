import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { orphanPids } from './orphans.ts';
import type { ProcessEntry } from './orphans.ts';
import { STACK_INFO_PATH, STACK_PID_PATH, STACK_STOP_PATH, STACK_TEMP_PREFIX } from './stack-paths.ts';

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function killTree(pid: number): void {
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(pid, 'SIGKILL');
}

function listPostgres(): ProcessEntry[] {
  if (process.platform === 'win32') {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; commandLine = [string]$_.CommandLine } } | ConvertTo-Json -Compress";
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
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

/** Stops what an earlier, interrupted run of the stack left behind: its own process tree and its database servers. */
export function cleanOrphans(): { stackPid?: number; servers: number[] } {
  const result: { stackPid?: number; servers: number[] } = { servers: [] };
  if (existsSync(STACK_PID_PATH)) {
    const pid = Number(readFileSync(STACK_PID_PATH, 'utf8'));
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
      killTree(pid);
      result.stackPid = pid;
    }
  }
  for (const pid of orphanPids(listPostgres(), STACK_TEMP_PREFIX)) {
    try {
      killTree(pid);
      result.servers.push(pid);
    } catch (error) {
      process.stderr.write(`could not stop leftover server ${pid}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  for (const stale of [STACK_INFO_PATH, STACK_STOP_PATH, STACK_PID_PATH]) rmSync(stale, { force: true });
  return result;
}

if (process.argv[1] !== undefined && /clean-orphans\.ts$/.test(process.argv[1])) {
  const cleaned = cleanOrphans();
  if (cleaned.stackPid !== undefined || cleaned.servers.length > 0) {
    process.stdout.write(`cleaned leftovers of an earlier e2e stack: process ${cleaned.stackPid ?? '-'}, servers ${cleaned.servers.join(',') || '-'}\n`);
  }
}
