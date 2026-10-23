# Runbook: scheduled jobs

Stories: ST-ADM-001, ST-ADM-002. Code: `packages/kernel/src/scheduler.ts` (port and timer adapter),
`packages/db/src/job-runner.ts` (lock, history, alert), `packages/db/src/jobs.ts` (the jobs).

## The jobs

| Job | Interval | What it does | Runs in |
|---|---|---|---|
| `audit-seal` | 5 minutes | seals the new audit rows of every tenant into a chained Merkle window | API process or command line |
| `audit-verify` | hourly | walks every seal chain; a broken window raises `AUDIT_CHAIN_BROKEN`, then the job itself fails | API process or command line |
| `outbox-relay` | 5 seconds | one relay batch; raises `OUTBOX_LAG` and `OUTBOX_EVENT_DEAD` | API process only (it owns the broker adapter) |
| `idempotency-purge` | hourly | deletes expired idempotency rows that no legal hold contains | API process or command line |
| `certificate-expiry` | daily | marks the signing certificates whose validity has ended as `Expired` in every tenant (reads already report them as Expired; the 30-day warning of ADM-08 is computed when the register is read) | API process only |
| `access-cache-expiry` | every minute | drops the lapsed entries of the access cache of the process | API process only |

"Every tenant" is the tenant registry plus the platform tenant, which holds the audit rows of control-plane commands.
One tenant failing does not stop the others; the job then fails with `TenantJobsFailed` after the last tenant.

## One owner per job

A runner takes `pg_try_advisory_lock(hashtextextended('job:<name>', 0))` on a dedicated connection and holds it for the
run. Any number of API processes and command lines can run the same job; the one that does not get the lock records
`SKIPPED` and does nothing. The lock belongs to the database session, so a runner that dies (process killed, connection
cut, backend terminated) frees it, and the next runner of the next interval takes over. A run whose connection dies
before it ends is recorded `FAILED` with error class `JobLockLost`: another runner may have started the job meanwhile,
so check the job is idempotent for that window (all of the above are).

## Run a job by hand

```
DATABASE_URL_APP=postgres://...machvon_app...  DATABASE_URL_CONTROL=postgres://...machvon_control...  npm run jobs:run -- audit-seal
```

`audit-seal`, `audit-verify` and `idempotency-purge` are available. Exit code 0: the job succeeded, or another runner
holds it (the output says `SKIPPED`); 1: it failed (one JSON line per alert is printed before); 2: usage or
configuration. The relay and the access cache are refused with the usage line.

## Alerts

| Alert | Raised by | Context | First action |
|---|---|---|---|
| `JOB_FAILED` | the runner, once per failed run | `job`, `errorClass` (never a message) | read the process log for the job name at that time; the next interval runs again on its own |
| `AUDIT_CHAIN_BROKEN` | `audit-verify`, per tenant | `tenantId`, seal id, `fromSeq`, `toSeq`, `reason` | follow `docs/runbooks/audit-tamper-drill.md`; the `audit-verify` run also fails, so `JOB_FAILED` follows it |

A `JOB_FAILED` for `audit-verify` with error class `AuditChainBroken` is the same incident as the `AUDIT_CHAIN_BROKEN`
alert before it, not a second one.

`job_runs_total{job, outcome}` counts the runs (`SUCCESS`, `FAILED`, `SKIPPED`). A job whose counter stops moving is not
running anywhere: check the API processes and the scheduler of the deployment.

## In the API process

**Not wired yet.** `npm start` (`apps/api/src/serve.ts`, `bootstrap.ts`) does not create the scheduler, the outbox relay or the
alert sink; only the end-to-end test stack (`apps/api/test/e2e-stack/serve.stack.ts`) does. Until it is wired
(`docs/m2-alignment-review.md`, N1), run `audit-seal`, `audit-verify` and `idempotency-purge` from an external scheduler with the
command line above; the relay and `certificate-expiry` have no command line and do not run at all. What follows describes the
intended behaviour of the wiring.

`IntervalScheduler` (`@machvon/kernel`) registers `runner.scheduled(name, JOB_INTERVAL_SECONDS[name])` for each job. The
next run is timed from the end of the previous one, so a slow job never overlaps itself. `stop()` clears the timers and
waits for the run in flight; call it in the shutdown hook before the pools are closed.
