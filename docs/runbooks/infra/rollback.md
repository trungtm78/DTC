# Releases, canary and rollback

Declaration: `infra/pipelines/`. The production pipeline is manual, needs two approvers (release manager and security
administration) and runs a canary by tenant cohort: the pilot at 5%, then cohort 1 at 25%, then everyone, with a bake
time between steps. It aborts on error rate, p95 latency or any isolation violation.

## Rolling back

The application rolls back by redeploying the previous version, within 15 minutes. Database schema changes are
expand-contract (`npm run expand-contract:check`), so the previous version always works with the current schema: the
schema is never rolled back, and a contract step ships in a later release than the code that stopped using the column.

A feature behind a flag is switched off without a deploy.

## Steps

1. Abort the canary (the pipeline stops promoting); traffic goes back to the previous version.
2. Redeploy the previous version for the cohorts already promoted.
3. If the change was behind a flag, switch it off first: it is faster than a deploy.
4. Record the cause, and fix forward; do not rewrite the migration that already ran.
