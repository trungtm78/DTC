import { newCommandAttempt } from '@machvon/api-client';
import type { CommandAttempt } from '@machvon/api-client';

/**
 * Hands out the idempotency attempt of the user's current intention: the same payload (a retry after a failure, a second
 * click) reuses it so the server runs the command once, a different payload is a new intention with a new key, and a
 * success ends the intention.
 */
export class AttemptRegistry {
  private last: { payload: string; attempt: CommandAttempt } | undefined;

  constructor(private readonly start: () => CommandAttempt = newCommandAttempt) {}

  forPayload(payload: unknown): CommandAttempt {
    const text = JSON.stringify(payload);
    if (this.last?.payload !== text) this.last = { payload: text, attempt: this.start() };
    return this.last.attempt;
  }

  done(): void {
    this.last = undefined;
  }
}
