/** A recurring job: `run` is invoked every `intervalSeconds` and never twice at once. */
export interface JobDefinition {
  name: string;
  intervalSeconds: number;
  run(): Promise<void>;
}

/** SKIPPED: another runner held the job lock, so nothing ran. */
export type JobOutcome = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface JobRunRecord {
  name: string;
  startedAt: Date;
  endedAt: Date;
  outcome: JobOutcome;
}

/** The scheduling port: the job runner and the timer adapter are interchangeable behind it. */
export interface Scheduler {
  register(job: JobDefinition): void;
  start(): void;
  /** Stops the timers and resolves once the runs in flight have ended. */
  stop(): Promise<void>;
}

/** The only clock the timer adapter uses, so tests drive time by hand. */
export interface TimerPort {
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export const SYSTEM_TIMERS: TimerPort = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

interface Registered {
  job: JobDefinition;
  handle: unknown;
  running: Promise<void> | undefined;
}

export interface IntervalSchedulerOptions {
  /** Told when a run rejects; the schedule carries on. A job runner never rejects, so this is the safety net. */
  onError: (jobName: string, error: unknown) => void;
  timers?: TimerPort;
}

/**
 * Runs each registered job on its interval. The next run is timed from the end of the previous one, so a slow job
 * never overlaps itself.
 */
export class IntervalScheduler implements Scheduler {
  private readonly timers: TimerPort;
  private readonly onError: (jobName: string, error: unknown) => void;
  private readonly jobs = new Map<string, Registered>();
  private started = false;

  constructor(options: IntervalSchedulerOptions) {
    this.timers = options.timers ?? SYSTEM_TIMERS;
    this.onError = options.onError;
  }

  register(job: JobDefinition): void {
    if (this.started) throw new Error('jobs must be registered before the scheduler starts');
    if (this.jobs.has(job.name)) throw new Error(`job ${job.name} is registered twice`);
    if (!Number.isSafeInteger(job.intervalSeconds) || job.intervalSeconds < 1) throw new RangeError(`job ${job.name}: intervalSeconds must be a positive integer`);
    this.jobs.set(job.name, { job, handle: undefined, running: undefined });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const entry of this.jobs.values()) this.arm(entry);
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const entry of this.jobs.values()) {
      this.timers.clearTimer(entry.handle);
      entry.handle = undefined;
    }
    await Promise.all([...this.jobs.values()].map((entry) => entry.running));
  }

  private arm(entry: Registered): void {
    entry.handle = this.timers.setTimer(() => {
      entry.running = this.fire(entry);
    }, entry.job.intervalSeconds * 1000);
  }

  private async fire(entry: Registered): Promise<void> {
    try {
      await entry.job.run();
    } catch (error) {
      this.onError(entry.job.name, error);
    }
    entry.running = undefined;
    if (this.started) this.arm(entry);
  }
}
