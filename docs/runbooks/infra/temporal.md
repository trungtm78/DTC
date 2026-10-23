# Runbook: Temporal

Story: ST-KERNEL-044. Declaration: `infra/components/temporal.json`; alert rules `infra/alerts/temporal.json`.

Temporal is the first real workflow engine behind the orchestrator port (`packages/kernel/src/orchestrator.ts`). The
product depends on the port, not on Temporal, so the in-process adapter keeps working while this component is `PLANNED`.

## Entering use

The component stays `PLANNED` until `npm run infra:check -- --require-entered temporal` passes: this runbook, the alert
rules and a restore test (restore the Temporal database from the PostgreSQL backup and resume a paused workflow). See
[README](README.md). Pin the worker version for in-flight workflows (see the orchestrator tests) before the first use.

## Stuck workflows

Alert `temporal-stuck-workflow`: a workflow has been open longer than its threshold.

1. Describe the workflow: which activity is pending, how many attempts, the last failure.
2. An activity failing on a command error (domain code) is a product decision, not an outage: fix the cause and retry.
3. Never terminate a workflow that holds a human task; resolve the task through the product.

## Backlog

Alert `temporal-task-queue-backlog`: the task queue backlog age is above 5 minutes.

1. Check the workers are connected and not pinned to a retired version.
2. Scale workers; check the database latency behind Temporal.
