# OUTBOX_LAG

**Owner:** platform-oncall · **Severity:** critical · **Rule:** `alerts/rules/OUTBOX_LAG.json`

## What it means

The relay is not keeping up or has stopped: events reach consumers late (notifications, provisioning, search).

## What to do

1. Check `/health/ready` and the `outbox-relay` job (`job_runs_total{job="outbox-relay"}`).
2. Look for a broker adapter outage or a database lock on `outbox_event`.
3. If the relay runs, raise the batch size or add a node; if it does not, restart the API process.
4. The alert resolves when the oldest pending event is younger than 300 seconds.
