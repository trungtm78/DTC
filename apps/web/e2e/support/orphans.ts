export interface ProcessEntry {
  pid: number;
  /** Executable name, for example `postgres.exe`. */
  name: string;
  commandLine: string;
}

/** Lower case, forward slashes, one trailing slash: how paths from different tools are compared. */
export function normalisePath(path: string): string {
  return `${path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/`;
}

/**
 * The leftovers of an earlier stack run of THIS workspace: database server processes that run a binary from this
 * repository's node_modules and whose command line names the stack's private temporary directory prefix. Nothing
 * else is ever listed, so another checkout's running stack, or another test run's servers, are never touched.
 */
export function orphanPids(processes: readonly ProcessEntry[], tempPrefix: string, repoRoot: string): number[] {
  const root = normalisePath(repoRoot);
  return processes
    .filter(
      (entry) =>
        /^postgres(\.exe)?$/i.test(entry.name) &&
        entry.commandLine.includes(tempPrefix) &&
        normalisePath(entry.commandLine).includes(root),
    )
    .map((entry) => entry.pid);
}
