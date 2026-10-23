import { IntervalScheduler, SYSTEM_TIMERS } from '../src/scheduler.ts';
import type { TimerPort } from '../src/scheduler.ts';

/** A timer port driven by hand: nothing fires until `advance` moves the clock. */
class ManualTimers implements TimerPort {
  private now = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { dueAt: number; callback: () => void }>();

  setTimer(callback: () => void, delayMs: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, { dueAt: this.now + delayMs, callback });
    return id;
  }

  clearTimer(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  get armed(): number {
    return this.pending.size;
  }

  /** Moves the clock and fires what falls due, in due order; each callback gets a macrotask to run its job. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, timer]) => timer.dueAt <= target).sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
      if (due === undefined) break;
      this.pending.delete(due[0]);
      this.now = due[1].dueAt;
      due[1].callback();
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.now = target;
  }
}

describe('IntervalScheduler', () => {
  it('runs each job on its own interval, timed on the injected clock', async () => {
    const timers = new ManualTimers();
    const runs: string[] = [];
    const scheduler = new IntervalScheduler({ timers, onError: () => undefined });
    scheduler.register({ name: 'fast', intervalSeconds: 10, run: async () => void runs.push('fast') });
    scheduler.register({ name: 'slow', intervalSeconds: 25, run: async () => void runs.push('slow') });
    scheduler.start();
    await timers.advance(9_999);
    expect(runs).toEqual([]);
    await timers.advance(1);
    expect(runs).toEqual(['fast']);
    await timers.advance(40_000);
    expect(runs.filter((name) => name === 'fast')).toHaveLength(5);
    expect(runs.filter((name) => name === 'slow')).toHaveLength(2);
    await scheduler.stop();
  });

  it('never overlaps a job with itself: the next run is timed from the end of the previous one', async () => {
    const timers = new ManualTimers();
    let release: (() => void) | undefined;
    let started = 0;
    const scheduler = new IntervalScheduler({ timers, onError: () => undefined });
    scheduler.register({
      name: 'slow',
      intervalSeconds: 5,
      run: () => {
        started += 1;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    scheduler.start();
    await timers.advance(5_000);
    expect(started).toBe(1);
    expect(timers.armed).toBe(0);
    await timers.advance(60_000);
    expect(started).toBe(1);
    release?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(timers.armed).toBe(1);
    await timers.advance(5_000);
    expect(started).toBe(2);
    release?.();
    await scheduler.stop();
  });

  it('reports a rejected run and keeps the schedule', async () => {
    const timers = new ManualTimers();
    const errors: Array<{ name: string; error: unknown }> = [];
    let calls = 0;
    const scheduler = new IntervalScheduler({ timers, onError: (name, error) => errors.push({ name, error }) });
    scheduler.register({
      name: 'flaky',
      intervalSeconds: 1,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
      },
    });
    scheduler.start();
    await timers.advance(2_000);
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.name).toBe('flaky');
    await scheduler.stop();
  });

  it('stops the timers and waits for the run in flight', async () => {
    const timers = new ManualTimers();
    let release: (() => void) | undefined;
    let finished = false;
    const scheduler = new IntervalScheduler({ timers, onError: () => undefined });
    scheduler.register({
      name: 'job',
      intervalSeconds: 1,
      run: () =>
        new Promise<void>((resolve) => {
          release = () => {
            finished = true;
            resolve();
          };
        }),
    });
    scheduler.start();
    await timers.advance(1_000);
    const stopped = scheduler.stop();
    expect(finished).toBe(false);
    release?.();
    await stopped;
    expect(finished).toBe(true);
    expect(timers.armed).toBe(0);
    await timers.advance(10_000);
  });

  it('stops before the first run without leaving a timer', async () => {
    const timers = new ManualTimers();
    const scheduler = new IntervalScheduler({ timers, onError: () => undefined });
    scheduler.register({ name: 'job', intervalSeconds: 1, run: async () => undefined });
    scheduler.start();
    scheduler.start();
    expect(timers.armed).toBe(1);
    await scheduler.stop();
    expect(timers.armed).toBe(0);
  });

  it('refuses a duplicate name, a bad interval and a registration after start', () => {
    const scheduler = new IntervalScheduler({ timers: new ManualTimers(), onError: () => undefined });
    scheduler.register({ name: 'job', intervalSeconds: 1, run: async () => undefined });
    expect(() => scheduler.register({ name: 'job', intervalSeconds: 2, run: async () => undefined })).toThrow('registered twice');
    expect(() => scheduler.register({ name: 'zero', intervalSeconds: 0, run: async () => undefined })).toThrow(RangeError);
    expect(() => scheduler.register({ name: 'fraction', intervalSeconds: 1.5, run: async () => undefined })).toThrow(RangeError);
    scheduler.start();
    expect(() => scheduler.register({ name: 'late', intervalSeconds: 1, run: async () => undefined })).toThrow('before the scheduler starts');
  });

  it('uses the system timers by default', async () => {
    const handle = SYSTEM_TIMERS.setTimer(() => undefined, 60_000);
    SYSTEM_TIMERS.clearTimer(handle);
    const scheduler = new IntervalScheduler({ onError: () => undefined });
    scheduler.register({ name: 'job', intervalSeconds: 3600, run: async () => undefined });
    scheduler.start();
    await scheduler.stop();
  });
});
