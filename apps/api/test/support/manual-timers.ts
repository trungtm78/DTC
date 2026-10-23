import type { TimerPort } from '@machvon/kernel';

/** A clock the test turns by hand: a timer fires when the test says so, never on its own. */
export class ManualTimers implements TimerPort {
  private nextHandle = 1;
  private readonly armed = new Map<number, { callback: () => void; delayMs: number }>();

  setTimer(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle++;
    this.armed.set(handle, { callback, delayMs });
    return handle;
  }

  clearTimer(handle: unknown): void {
    this.armed.delete(handle as number);
  }

  /** The delay of every armed timer, shortest first. */
  delays(): number[] {
    return [...this.armed.values()].map((timer) => timer.delayMs).sort((a, b) => a - b);
  }

  /** Fires (and disarms) every timer with this delay, as the clock would when the delay has passed. */
  fire(delayMs: number): void {
    for (const [handle, timer] of [...this.armed]) {
      if (timer.delayMs !== delayMs) continue;
      this.armed.delete(handle);
      timer.callback();
    }
  }
}

/** Waits for a condition, polling; the failure names what was awaited. */
export async function until(done: () => boolean | Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((wait) => setTimeout(wait, 20));
  }
}
