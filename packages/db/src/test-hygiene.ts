/** A running process as the operating system lists it. */
export interface ProcessEntry {
  pid: number;
  /** Executable name, for example `postgres.exe`. */
  name: string;
  commandLine: string;
}

/** The record a test run writes about itself, so the next run can tell a live run from a leftover one. */
export interface RunRecord {
  /** The pid of the jest process that owns the shared server. */
  runnerPid: number;
  /** Milliseconds since the epoch when the record was written (the runner started before that). */
  writtenAt: number;
}

export interface ProcessInfo {
  pid: number;
  commandLine: string;
  /** Milliseconds since the epoch; unknown when the platform did not tell. */
  startedAt?: number;
}

/** Everything cleanLeftovers touches, so its decisions are testable without stopping anything. */
export interface HygieneDeps {
  repoRoot: string;
  tempPrefix: string;
  readRecord(): RunRecord | undefined;
  /** The running process with that pid, or undefined when there is none. */
  inspect(pid: number): ProcessInfo | undefined;
  listPostgres(): ProcessEntry[];
  /** Stops the process and its children; throws when it cannot. */
  kill(pid: number): void;
  /** Removes the record file. */
  discard(): void;
  report(message: string): void;
}

export interface CleanupResult {
  servers: number[];
  /** The runner of an earlier record is still alive: nothing was touched. */
  runnerAlive?: true;
}

/** The runner is started before it writes its record; clocks and file times are coarse, so allow a little slack. */
const START_SLACK_MS = 5_000;
const RUNNER_MARKER = /jest/i;

/** Lower case, forward slashes, one trailing slash: how paths from different tools are compared. */
export function normalisePath(path: string): string {
  return `${path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/`;
}

/**
 * Database servers of THIS repository that run in a directory with the shared prefix: a server of this workspace
 * whose test run is gone. Servers of another checkout, of another prefix or of another program are never listed.
 */
export function leftoverServerPids(processes: readonly ProcessEntry[], tempPrefix: string, repoRoot: string): number[] {
  const root = normalisePath(repoRoot);
  return processes
    .filter(
      (entry) =>
        /^postgres(\.exe)?$/i.test(entry.name) && entry.commandLine.includes(tempPrefix) && normalisePath(entry.commandLine).includes(root),
    )
    .map((entry) => entry.pid);
}

/**
 * A pid is only the runner of this record when the process now holding it is a jest run that started before the
 * record was written: a pid the system reused for another program, or a process that started later, is not. A start
 * time that is unknown is not trusted.
 */
export function isRunnerProcess(info: ProcessInfo, record: RunRecord): boolean {
  if (!RUNNER_MARKER.test(info.commandLine)) return false;
  return info.startedAt !== undefined && info.startedAt <= record.writtenAt + START_SLACK_MS;
}

/**
 * Stops what an interrupted earlier run left behind (its shared database servers), but only once its runner is gone:
 * while the runner of the record is alive nothing is touched.
 */
export function cleanLeftovers(deps: HygieneDeps): CleanupResult {
  const record = deps.readRecord();
  if (record !== undefined) {
    const info = deps.inspect(record.runnerPid);
    if (info !== undefined && isRunnerProcess(info, record)) {
      deps.report(`the test run ${record.runnerPid} is still alive; its servers and record are left alone`);
      return { servers: [], runnerAlive: true };
    }
  }
  const servers: number[] = [];
  for (const pid of leftoverServerPids(deps.listPostgres(), deps.tempPrefix, deps.repoRoot)) {
    try {
      deps.kill(pid);
      servers.push(pid);
    } catch (error) {
      deps.report(`could not stop leftover server ${pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  deps.discard();
  return { servers };
}
