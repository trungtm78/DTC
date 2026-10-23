export interface ProcessEntry {
  pid: number;
  /** Executable name, for example `postgres.exe`. */
  name: string;
  commandLine: string;
}

/**
 * The leftovers of an earlier stack run: database server processes whose command line names the stack's private
 * temporary directory prefix. Nothing else is ever listed, so another test run's servers are never touched.
 */
export function orphanPids(processes: readonly ProcessEntry[], tempPrefix: string): number[] {
  return processes
    .filter((entry) => /^postgres(\.exe)?$/i.test(entry.name) && entry.commandLine.includes(tempPrefix))
    .map((entry) => entry.pid);
}
