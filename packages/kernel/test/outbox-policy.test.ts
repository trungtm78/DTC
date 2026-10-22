import { OUTBOX_BATCH_SIZE, OUTBOX_LAG_ALERT_SECONDS, OUTBOX_MAX_ATTEMPTS, outboxDelaySeconds } from '../src/outbox-policy.ts';

describe('outboxDelaySeconds', () => {
  it.each([
    [1, 1],
    [2, 2],
    [10, 512],
    [11, 600],
    [20, 600],
  ])('attempt %i waits %i seconds', (attempt, seconds) => {
    expect(outboxDelaySeconds(attempt)).toBe(seconds);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects attempt %p', (attempt) => {
    expect(() => outboxDelaySeconds(attempt)).toThrow(RangeError);
  });
});

describe('constants', () => {
  it('uses batches of 100, 20 attempts and a 300 s lag alert', () => {
    expect([OUTBOX_BATCH_SIZE, OUTBOX_MAX_ATTEMPTS, OUTBOX_LAG_ALERT_SECONDS]).toEqual([100, 20, 300]);
  });
});
