import { NOOP_ALERTS, NOOP_METRICS } from '../src/ports.ts';

describe('no-op sinks', () => {
  it('accept every call and return nothing', () => {
    expect(NOOP_METRICS.increment('x', { a: 'b' })).toBeUndefined();
    expect(NOOP_METRICS.gauge('x', 1)).toBeUndefined();
    expect(NOOP_ALERTS.raise('X', { a: 1 })).toBeUndefined();
  });
});
