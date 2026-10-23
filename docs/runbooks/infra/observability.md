# Runbook: observability

Story: ST-KERNEL-042, ST-KERNEL-050, ST-KERNEL-051. Declaration: `infra/components/observability.json`; alert rules
`infra/alerts/observability.json`.

Logs, metrics and traces go to a sink in Vietnam. The alert path is independent of the product: alerts go to
`ops-pager`, never through the notification centre, so they still arrive when the product is down.

## Entering use

The component stays `PLANNED` until `npm run infra:check -- --require-entered observability` passes: this runbook, the
alert rules and a restore test (rebuild the dashboards and alert rules from the repository on an empty instance). See
[README](README.md).

## Collector

Alert `collector-down`: no telemetry from a collector for 5 minutes.

1. Check the collector process and its host first; a collector outage hides every other alert behind it.
2. Applications buffer briefly and then drop; note the gap in the incident record.
3. A dead-man's switch alert outside the product confirms that the pager path itself works.

## Queue

Alert `collector-queue-full`: the exporter queue is above 80%.

1. Check the sink: slow or refusing writes are the usual cause.
2. Reduce sampling for traces temporarily rather than dropping logs; audit-relevant records never go through sampling.
3. Restore normal sampling after the queue drains.
