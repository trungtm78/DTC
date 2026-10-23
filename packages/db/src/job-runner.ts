import { NOOP_ALERTS, NOOP_METRICS } from '@machvon/kernel';
import type { AlertSink, JobDefinition, JobOutcome, JobRunRecord, MetricsSink } from '@machvon/kernel';
import type { Pool, PoolClient } from 'pg';

/** Raised after a run failed, or lost its lock before it ended (context: job name and error class, never a message). */
export const JOB_FAILED_ALERT = 'JOB_FAILED';

const DEFAULT_HISTORY_LIMIT = 100;
const LOCK_LOST = 'JobLockLost';

export interface JobHandler {
  name: string;
  run(): Promise<void>;
}

export interface JobRunnerOptions {
  metrics?: MetricsSink;
  alerts?: AlertSink;
  /** Tests inject the clock. */
  now?: () => Date;
  /** Runs kept in memory per runner; the oldest are dropped. */
  historyLimit?: number;
}

// Only the class name is reported: messages can carry personal data or SQL text.
function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}

/**
 * Runs named jobs under a database advisory lock, so exactly one runner executes a job at a time wherever the runners
 * live. The lock belongs to the session that took it: a runner that dies (the process or its connection) frees it, and
 * the next runner takes over. A run that loses its connection before it ends is a failure, because another runner may
 * have started the same job meanwhile.
 * `pool` may connect as any role: advisory locks need no privilege.
 */
export class JobRunner {
  private readonly pool: Pool;
  private readonly metrics: MetricsSink;
  private readonly alerts: AlertSink;
  private readonly now: () => Date;
  private readonly historyLimit: number;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly records: JobRunRecord[] = [];

  constructor(pool: Pool, options: JobRunnerOptions = {}) {
    const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) throw new RangeError('historyLimit must be a positive integer');
    this.pool = pool;
    this.metrics = options.metrics ?? NOOP_METRICS;
    this.alerts = options.alerts ?? NOOP_ALERTS;
    this.now = options.now ?? (() => new Date());
    this.historyLimit = historyLimit;
  }

  register(handler: JobHandler): void {
    if (this.handlers.has(handler.name)) throw new Error(`job ${handler.name} is registered twice`);
    this.handlers.set(handler.name, handler);
  }

  /** The names of the registered jobs, in registration order. */
  names(): string[] {
    return [...this.handlers.keys()];
  }

  /** The runs this runner made, oldest first; one job's, or all. */
  history(name?: string): readonly JobRunRecord[] {
    return name === undefined ? [...this.records] : this.records.filter((record) => record.name === name);
  }

  /** The job as the scheduler port wants it: every run goes through `runOnce`, which never rejects for a failed job. */
  scheduled(name: string, intervalSeconds: number): JobDefinition {
    return { name, intervalSeconds, run: async () => void (await this.runOnce(name)) };
  }

  /**
   * Takes the job lock, runs the job and records `{ startedAt, endedAt, outcome }`. Another runner holding the lock
   * is not a failure: the outcome is SKIPPED and the job did not run.
   */
  async runOnce(name: string): Promise<JobRunRecord> {
    const handler = this.handlers.get(name);
    if (handler === undefined) throw new Error(`unknown job ${name}`);
    const startedAt = this.now();
    const client = await this.connect(name, startedAt);
    if (!('query' in client)) return client;
    // A backend killed while the client is checked out is reported as an 'error' event; the lock check reads it.
    let connectionError: Error | undefined;
    const onClientError = (error: Error): void => {
      connectionError = error;
    };
    client.on('error', onClientError);
    let discard: Error | undefined;
    try {
      const locked = await this.tryLock(client, name);
      if (locked instanceof Error) {
        discard = locked;
        return this.failed(name, startedAt, errorClassOf(locked));
      }
      if (!locked) return this.finish(name, startedAt, 'SKIPPED');
      const failure = await this.execute(handler);
      const lockLost = await this.lockLost(client, name, connectionError);
      if (lockLost) discard = connectionError ?? new Error(LOCK_LOST);
      if (failure !== undefined) return this.failed(name, startedAt, errorClassOf(failure));
      return lockLost ? this.failed(name, startedAt, LOCK_LOST) : this.finish(name, startedAt, 'SUCCESS');
    } finally {
      client.off('error', onClientError);
      client.release(discard);
    }
  }

  /** A connection, or the FAILED record of the run when the database cannot be reached. */
  private async connect(name: string, startedAt: Date): Promise<PoolClient | JobRunRecord> {
    try {
      return await this.pool.connect();
    } catch (error) {
      return this.failed(name, startedAt, errorClassOf(error));
    }
  }

  private failed(name: string, startedAt: Date, errorClass: string): JobRunRecord {
    this.alerts.raise(JOB_FAILED_ALERT, { job: name, errorClass });
    return this.finish(name, startedAt, 'FAILED');
  }

  /** Whether this session now holds the job lock, or the failure of the connection that could not ask. */
  private async tryLock(client: PoolClient, name: string): Promise<boolean | Error> {
    try {
      const result = await client.query<{ locked: boolean }>('select pg_try_advisory_lock(hashtextextended($1, 0)) as locked', [`job:${name}`]);
      return result.rows[0]?.locked === true;
    } catch (error) {
      return error instanceof Error ? error : new Error('job lock failed');
    }
  }

  /** Returns what the job threw, or undefined when it completed. */
  private async execute(handler: JobHandler): Promise<unknown> {
    try {
      await handler.run();
      return undefined;
    } catch (error) {
      return error ?? new Error('job failed');
    }
  }

  /** Unlocks at the end of a run; a connection that cannot answer has lost the session, and the lock with it. */
  private async lockLost(client: PoolClient, name: string, connectionError: Error | undefined): Promise<boolean> {
    if (connectionError !== undefined) return true;
    try {
      const result = await client.query<{ released: boolean }>('select pg_advisory_unlock(hashtextextended($1, 0)) as released', [`job:${name}`]);
      return result.rows[0]?.released !== true;
    } catch {
      return true;
    }
  }

  private finish(name: string, startedAt: Date, outcome: JobOutcome): JobRunRecord {
    const record: JobRunRecord = { name, startedAt, endedAt: this.now(), outcome };
    this.records.push(record);
    if (this.records.length > this.historyLimit) this.records.shift();
    this.metrics.increment('job_runs_total', { job: name, outcome });
    return record;
  }
}
