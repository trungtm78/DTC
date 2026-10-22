export const OUTBOX_BATCH_SIZE = 100;
export const OUTBOX_MAX_ATTEMPTS = 20;
export const OUTBOX_LAG_ALERT_SECONDS = 300;

const MAX_DELAY_SECONDS = 600;

/** Wait before retry number `attempt` (1-based): exponential from 1 s, capped at 10 minutes. */
export function outboxDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer');
  return Math.min(MAX_DELAY_SECONDS, 2 ** (attempt - 1));
}
