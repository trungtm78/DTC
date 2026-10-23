import type { AlertSink, MetricsSink } from './ports.ts';

export type AlertSeverity = 'critical' | 'warning';
/** `operations` alerts reach the on-call people through their own channel; they never travel through the notification module. */
export type AlertChannel = 'operations' | 'product';
export type AlertAdapter = 'log' | 'webhook' | 'notification';

export type AlertSource =
  /** Fires whenever the code is raised through the AlertSink (`raise(code, context)`). */
  | { type: 'event'; code: string }
  /** Fires while the latest value of the gauge (with the given labels) is above the threshold. */
  | { type: 'gauge'; metric: string; labels?: Readonly<Record<string, string>>; above: number }
  /** Fires when the counter (summed over the labels given) grew by more than `increaseAbove` since the previous evaluation. */
  | { type: 'counter'; metric: string; labels?: Readonly<Record<string, string>>; increaseAbove: number };

export interface AlertRule {
  id: string;
  severity: AlertSeverity;
  channel: AlertChannel;
  /** The team that answers the alert (a name, never a person). */
  owner: string;
  /** Path of the runbook file, relative to the repository root. */
  runbook: string;
  /** How the alert is delivered; an `operations` rule is never delivered through `notification`. */
  adapter: AlertAdapter;
  source: AlertSource;
  summary: string;
}

export interface FiredAlert {
  ruleId: string;
  severity: AlertSeverity;
  channel: AlertChannel;
  owner: string;
  runbook: string;
  /** The measured value (the gauge, the counter growth, or 1 for an event). */
  value: number;
  at: Date;
}

export interface MetricSample {
  name: string;
  value: number;
  labels: Readonly<Record<string, string>>;
}

export interface MetricsSnapshot {
  gauges: readonly MetricSample[];
  counters: readonly MetricSample[];
  /** Codes raised through the AlertSink since the previous snapshot. */
  events: readonly string[];
}

export interface Evaluation {
  /** Alerts that are firing now (a gauge above its threshold keeps firing on every evaluation). */
  fired: readonly FiredAlert[];
  /** Ids of the rules that fired in the previous evaluation and do not any more. */
  resolved: readonly string[];
}

const matches = (sample: MetricSample, name: string, labels: Readonly<Record<string, string>> | undefined): boolean =>
  sample.name === name && Object.entries(labels ?? {}).every(([key, value]) => sample.labels[key] === value);

/** Collects what the code emits through the two ports, so a snapshot can be evaluated against the rules. */
export class CollectingTelemetry implements MetricsSink, AlertSink {
  private readonly gaugeValues = new Map<string, MetricSample>();
  private readonly counterValues = new Map<string, MetricSample>();
  private events: string[] = [];

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = `${name}|${JSON.stringify(Object.entries(labels).sort())}`;
    const current = this.counterValues.get(key);
    this.counterValues.set(key, { name, labels, value: (current?.value ?? 0) + 1 });
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gaugeValues.set(`${name}|${JSON.stringify(Object.entries(labels).sort())}`, { name, value, labels });
  }

  raise(code: string): void {
    // Only the code is kept: the context of an alert can carry identifiers that do not belong in a snapshot.
    this.events.push(code);
  }

  /** The state now; the events are handed over once and cleared. */
  snapshot(): MetricsSnapshot {
    const events = this.events;
    this.events = [];
    return { gauges: [...this.gaugeValues.values()], counters: [...this.counterValues.values()], events };
  }
}

/**
 * Evaluates the rules over successive snapshots. A threshold is crossed only by a value strictly above it (300 s is
 * fine, 301 s fires). It remembers what fired, so the next evaluation can say what resolved.
 */
export class AlertEvaluator {
  private active = new Set<string>();
  private previousCounters = new Map<string, number>();

  private readonly rules: readonly AlertRule[];
  private readonly now: () => Date;

  constructor(rules: readonly AlertRule[], now: () => Date = () => new Date()) {
    this.rules = rules;
    this.now = now;
  }

  evaluate(snapshot: MetricsSnapshot): Evaluation {
    const at = this.now();
    const fired: FiredAlert[] = [];
    const currentCounters = new Map<string, number>();
    for (const rule of this.rules) {
      const value = this.measure(rule, snapshot, currentCounters);
      if (value !== undefined) fired.push({ ruleId: rule.id, severity: rule.severity, channel: rule.channel, owner: rule.owner, runbook: rule.runbook, value, at });
    }
    this.previousCounters = currentCounters;
    const firingNow = new Set(fired.map((alert) => alert.ruleId));
    const resolved = [...this.active].filter((id) => !firingNow.has(id));
    this.active = firingNow;
    return { fired, resolved };
  }

  private measure(rule: AlertRule, snapshot: MetricsSnapshot, counters: Map<string, number>): number | undefined {
    const { source } = rule;
    if (source.type === 'event') {
      const count = snapshot.events.filter((code) => code === source.code).length;
      return count > 0 ? count : undefined;
    }
    if (source.type === 'gauge') {
      const values = snapshot.gauges.filter((sample) => matches(sample, source.metric, source.labels)).map((sample) => sample.value);
      const highest = values.length === 0 ? undefined : Math.max(...values);
      return highest !== undefined && highest > source.above ? highest : undefined;
    }
    const total = snapshot.counters.filter((sample) => matches(sample, source.metric, source.labels)).reduce((sum, sample) => sum + sample.value, 0);
    counters.set(rule.id, total);
    // The first evaluation has nothing to compare with: it only records the baseline.
    const before = this.previousCounters.get(rule.id);
    const growth = before === undefined ? 0 : total - before;
    return growth > source.increaseAbove ? growth : undefined;
  }
}

/** The mandatory rule ids of the platform (ST-KERNEL-051); `alerts:check` fails when one has no rule file. */
export const MANDATORY_ALERT_RULES: readonly string[] = [
  'OUTBOX_LAG',
  'OUTBOX_EVENT_DEAD',
  'OUTBOX_CONTEXT_TAMPERED',
  'AUDIT_CHAIN_BROKEN',
  'JOB_FAILED',
  'ACCESS_REVOCATION_LAG',
  'AUTHZ_DENY_SPIKE',
  'PROVISIONING_FAILED',
  'LICENSE_EXPIRING',
];

export const LICENSE_EXPIRING_ALERT = 'LICENSE_EXPIRING';
const LICENSE_WARNING_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Raises LICENSE_EXPIRING for every Active license that ends within the warning window and has not ended yet. The
 * context names the tenant and the days left, nothing else. Returns how many were raised.
 */
export function raiseExpiringLicenses(
  sink: AlertSink,
  licenses: ReadonlyArray<{ tenantId: string; status: string; validUntil: Date }>,
  now: Date,
  warningDays: number = LICENSE_WARNING_DAYS,
): number {
  let raised = 0;
  for (const license of licenses) {
    const left = license.validUntil.getTime() - now.getTime();
    if (license.status !== 'Active' || left <= 0 || left > warningDays * DAY_MS) continue;
    sink.raise(LICENSE_EXPIRING_ALERT, { tenantId: license.tenantId, daysLeft: Math.floor(left / DAY_MS) });
    raised += 1;
  }
  return raised;
}

export const ACCESS_REVOCATION_LAG_METRIC = 'access_revocation_lag_seconds';

/** The 95th percentile (nearest rank) of the samples; 0 when there are none. */
export function percentile95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] as number;
}

/**
 * Reports how long revoked grants stayed usable (seconds from the revocation to the first refused request, one sample
 * per revocation): every sample and the p95 that the ACCESS_REVOCATION_LAG rule watches. The probe that measures the
 * samples calls this once per round.
 */
export function reportAccessRevocationLag(metrics: MetricsSink, samplesSeconds: readonly number[]): number {
  for (const sample of samplesSeconds) metrics.gauge(ACCESS_REVOCATION_LAG_METRIC, sample, { stat: 'sample' });
  const p95 = percentile95(samplesSeconds);
  metrics.gauge(ACCESS_REVOCATION_LAG_METRIC, p95, { stat: 'p95' });
  return p95;
}
