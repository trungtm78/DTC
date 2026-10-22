/** Metrics port; the real exporter arrives with the telemetry foundation (ST-KERNEL-050). */
export interface MetricsSink {
  increment(name: string, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}

/** Alert port; routing to the operations channel arrives with ST-KERNEL-051. */
export interface AlertSink {
  raise(code: string, context: Record<string, unknown>): void;
}

export const NOOP_METRICS: MetricsSink = {
  increment: () => undefined,
  gauge: () => undefined,
};

export const NOOP_ALERTS: AlertSink = {
  raise: () => undefined,
};
