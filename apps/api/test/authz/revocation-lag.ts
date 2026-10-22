export interface RevocationLagOptions {
  revocations: number;
  /** Revokes the access of subject `index` and resolves once the revoking command has committed. */
  revoke(index: number): Promise<void>;
  /** True once a request that still carries the old `sv` is refused for subject `index`. */
  isDenied(index: number): Promise<boolean>;
  intervalMs?: number;
  /** Gives up on a subject that is still served after this long: the revocation did not propagate. */
  timeoutSeconds?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RevocationLag {
  p95Seconds: number;
  samples: number[];
}

/** Nearest-rank percentile of already sorted samples. */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new RangeError('no samples');
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

/**
 * Measures the lag between the commit of a revocation and the first refusal of a request with the old token
 * (BR-IAM-13: p95 of at most 60 seconds). Subjects are measured one after the other.
 */
export async function measureRevocationLag(options: RevocationLagOptions): Promise<RevocationLag> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const intervalMs = options.intervalMs ?? 25;
  const timeoutMs = (options.timeoutSeconds ?? 120) * 1000;
  const samples: number[] = [];
  for (let index = 0; index < options.revocations; index += 1) {
    await options.revoke(index);
    const start = now();
    while (!(await options.isDenied(index))) {
      if (now() - start > timeoutMs) throw new Error(`access of subject ${index} was still served ${options.timeoutSeconds ?? 120} seconds after its revocation`);
      await sleep(intervalMs);
    }
    samples.push((now() - start) / 1000);
  }
  return { p95Seconds: percentile([...samples].sort((a, b) => a - b), 0.95), samples };
}
