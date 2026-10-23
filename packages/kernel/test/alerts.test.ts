import { AlertEvaluator, CollectingTelemetry, LICENSE_EXPIRING_ALERT, MANDATORY_ALERT_RULES, percentile95, raiseExpiringLicenses, reportAccessRevocationLag } from '../src/alerts.ts';
import type { AlertRule, MetricsSnapshot } from '../src/alerts.ts';

const base = { severity: 'critical' as const, channel: 'operations' as const, owner: 'platform-oncall', runbook: 'docs/runbooks/alerts/X.md', adapter: 'log' as const, summary: 's' };
const lag: AlertRule = { ...base, id: 'OUTBOX_LAG', source: { type: 'gauge', metric: 'outbox_oldest_pending_seconds', above: 300 } };
const revocation: AlertRule = { ...base, id: 'ACCESS_REVOCATION_LAG', source: { type: 'gauge', metric: 'access_revocation_lag_seconds', labels: { stat: 'p95' }, above: 60 } };
const dead: AlertRule = { ...base, id: 'OUTBOX_EVENT_DEAD', source: { type: 'event', code: 'OUTBOX_EVENT_DEAD' } };
const denies: AlertRule = { ...base, id: 'AUTHZ_DENY_SPIKE', severity: 'warning', source: { type: 'counter', metric: 'authz_decision_total', labels: { outcome: 'deny' }, increaseAbove: 100 } };
const NOW = new Date('2026-10-24T00:00:00Z');
const snap = (parts: Partial<MetricsSnapshot>): MetricsSnapshot => ({ gauges: [], counters: [], events: [], ...parts });
const gauge = (name: string, value: number, labels: Record<string, string> = {}) => ({ name, value, labels });

describe('AlertEvaluator', () => {
  it.each([
    [299, false],
    [300, false],
    [300.5, true],
    [301, true],
  ])('a gauge at %s seconds against the threshold of 300 fires: %s', (value, expected) => {
    const result = new AlertEvaluator([lag], () => NOW).evaluate(snap({ gauges: [gauge('outbox_oldest_pending_seconds', value)] }));
    expect(result.fired.map((alert) => alert.ruleId)).toEqual(expected ? ['OUTBOX_LAG'] : []);
  });

  it('carries owner, runbook, severity, channel, value and time on a fired alert, and resolves when the value drops', () => {
    const evaluator = new AlertEvaluator([lag], () => NOW);
    const firing = evaluator.evaluate(snap({ gauges: [gauge('outbox_oldest_pending_seconds', 400)] }));
    expect(firing.fired[0]).toEqual({ ruleId: 'OUTBOX_LAG', severity: 'critical', channel: 'operations', owner: 'platform-oncall', runbook: 'docs/runbooks/alerts/X.md', value: 400, at: NOW });
    expect(firing.resolved).toEqual([]);
    expect(evaluator.evaluate(snap({ gauges: [gauge('outbox_oldest_pending_seconds', 410)] })).fired).toHaveLength(1);
    const calm = evaluator.evaluate(snap({ gauges: [gauge('outbox_oldest_pending_seconds', 12)] }));
    expect(calm).toEqual({ fired: [], resolved: ['OUTBOX_LAG'] });
    expect(evaluator.evaluate(snap({})).resolved).toEqual([]);
  });

  it('looks only at the gauge with the labels of the rule: the p95 of the revocation lag, not its samples', () => {
    const evaluator = new AlertEvaluator([revocation], () => NOW);
    const samples = snap({ gauges: [gauge('access_revocation_lag_seconds', 500, { stat: 'sample' }), gauge('access_revocation_lag_seconds', 59, { stat: 'p95' })] });
    expect(evaluator.evaluate(samples).fired).toEqual([]);
    expect(evaluator.evaluate(snap({ gauges: [gauge('access_revocation_lag_seconds', 61, { stat: 'p95' })] })).fired).toHaveLength(1);
  });

  it('takes the highest of several gauges of the metric and ignores a metric of another name', () => {
    const evaluator = new AlertEvaluator([lag], () => NOW);
    const result = evaluator.evaluate(snap({ gauges: [gauge('outbox_oldest_pending_seconds', 10, { a: '1' }), gauge('outbox_oldest_pending_seconds', 900, { a: '2' }), gauge('other', 5000)] }));
    expect(result.fired[0]?.value).toBe(900);
  });

  it('fires an event rule once per snapshot with the number of occurrences, and not again when nothing was raised', () => {
    const evaluator = new AlertEvaluator([dead], () => NOW);
    expect(evaluator.evaluate(snap({ events: ['OUTBOX_EVENT_DEAD', 'JOB_FAILED', 'OUTBOX_EVENT_DEAD'] })).fired[0]?.value).toBe(2);
    expect(evaluator.evaluate(snap({ events: ['JOB_FAILED'] }))).toEqual({ fired: [], resolved: ['OUTBOX_EVENT_DEAD'] });
  });

  it('fires a counter rule on growth above the limit between two evaluations, the first one being the baseline', () => {
    const evaluator = new AlertEvaluator([denies], () => NOW);
    const counters = (deny: number, allow: number) => [
      { name: 'authz_decision_total', value: deny, labels: { outcome: 'deny' } },
      { name: 'authz_decision_total', value: allow, labels: { outcome: 'allow' } },
    ];
    expect(evaluator.evaluate(snap({ counters: counters(5000, 9000) })).fired).toEqual([]);
    expect(evaluator.evaluate(snap({ counters: counters(5100, 99_000) })).fired).toEqual([]);
    const spike = evaluator.evaluate(snap({ counters: counters(5201, 99_100) }));
    expect(spike.fired[0]).toMatchObject({ ruleId: 'AUTHZ_DENY_SPIKE', severity: 'warning', value: 101 });
    expect(evaluator.evaluate(snap({ counters: counters(5202, 99_200) })).resolved).toEqual(['AUTHZ_DENY_SPIKE']);
  });
});

describe('CollectingTelemetry', () => {
  it('collects what the code emits through both ports and hands the events over once', () => {
    const telemetry = new CollectingTelemetry();
    telemetry.gauge('outbox_oldest_pending_seconds', 5);
    telemetry.gauge('outbox_oldest_pending_seconds', 400);
    telemetry.increment('authz_decision_total', { outcome: 'deny' });
    telemetry.increment('authz_decision_total', { outcome: 'deny' });
    telemetry.increment('authz_decision_total', { outcome: 'allow' });
    telemetry.raise('JOB_FAILED');
    const first = telemetry.snapshot();
    expect(first.gauges).toEqual([{ name: 'outbox_oldest_pending_seconds', value: 400, labels: {} }]);
    expect(first.counters).toEqual(expect.arrayContaining([{ name: 'authz_decision_total', value: 2, labels: { outcome: 'deny' } }, { name: 'authz_decision_total', value: 1, labels: { outcome: 'allow' } }]));
    expect(first.events).toEqual(['JOB_FAILED']);
    expect(telemetry.snapshot().events).toEqual([]);
  });

  it('does not keep the context of an alert', () => {
    const telemetry = new CollectingTelemetry();
    telemetry.raise('AUDIT_CHAIN_BROKEN');
    expect(JSON.stringify(telemetry.snapshot())).not.toContain('tenantId');
  });
});

describe('raiseExpiringLicenses', () => {
  const raised: Array<{ code: string; context: Record<string, unknown> }> = [];
  const sink = { raise: (code: string, context: Record<string, unknown>) => void raised.push({ code, context }) };
  const day = 86_400_000;
  beforeEach(() => {
    raised.length = 0;
  });

  it('raises for Active licenses that end within 30 days and have not ended, naming the tenant and the days left', () => {
    const count = raiseExpiringLicenses(
      sink,
      [
        { tenantId: 't-soon', status: 'Active', validUntil: new Date(NOW.getTime() + 10.5 * day) },
        { tenantId: 't-edge', status: 'Active', validUntil: new Date(NOW.getTime() + 30 * day) },
        { tenantId: 't-far', status: 'Active', validUntil: new Date(NOW.getTime() + 30 * day + 1) },
        { tenantId: 't-ended', status: 'Active', validUntil: new Date(NOW.getTime()) },
        { tenantId: 't-revoked', status: 'Revoked', validUntil: new Date(NOW.getTime() + 5 * day) },
      ],
      NOW,
    );
    expect(count).toBe(2);
    expect(raised).toEqual([
      { code: LICENSE_EXPIRING_ALERT, context: { tenantId: 't-soon', daysLeft: 10 } },
      { code: LICENSE_EXPIRING_ALERT, context: { tenantId: 't-edge', daysLeft: 30 } },
    ]);
  });
});

describe('the mandatory rule set', () => {
  it('names the nine rules of ST-KERNEL-051', () => {
    expect([...MANDATORY_ALERT_RULES].sort()).toEqual(
      ['ACCESS_REVOCATION_LAG', 'AUDIT_CHAIN_BROKEN', 'AUTHZ_DENY_SPIKE', 'JOB_FAILED', 'LICENSE_EXPIRING', 'OUTBOX_CONTEXT_TAMPERED', 'OUTBOX_EVENT_DEAD', 'OUTBOX_LAG', 'PROVISIONING_FAILED'],
    );
  });
});

describe('reportAccessRevocationLag', () => {
  it('reports every sample and the p95 that the rule watches, and the rule fires on it at 61 seconds', () => {
    const telemetry = new CollectingTelemetry();
    const samples = Array.from({ length: 20 }, (_unused, n) => (n === 19 ? 61 : 5));
    expect(reportAccessRevocationLag(telemetry, samples)).toBe(5);
    const quiet = new AlertEvaluator([revocation], () => NOW).evaluate(telemetry.snapshot());
    expect(quiet.fired).toEqual([]);
    const slow = new CollectingTelemetry();
    expect(reportAccessRevocationLag(slow, [...samples.slice(0, 18), 61, 61])).toBe(61);
    expect(new AlertEvaluator([revocation], () => NOW).evaluate(slow.snapshot()).fired[0]).toMatchObject({ ruleId: 'ACCESS_REVOCATION_LAG', value: 61 });
  });

  it('takes the nearest rank for small sets and 0 for none', () => {
    expect(percentile95([])).toBe(0);
    expect(percentile95([7])).toBe(7);
    expect(percentile95([3, 1, 2])).toBe(3);
    expect(percentile95(Array.from({ length: 100 }, (_unused, n) => n + 1))).toBe(95);
  });
});
