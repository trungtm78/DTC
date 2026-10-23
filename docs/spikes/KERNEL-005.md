# KERNEL-005: self-hosted Temporal operations, workflow versioning and recovery

Status: **orchestrator pattern DONE on the in-process adapter; real Temporal NOT RUN** (no Temporal, no Docker).
Story: ST-KERNEL-005 (SPIKE-TEMPORAL). The pattern is also the acceptance of KERNEL-044.

## Question

Is a single self-hosted orchestrator operable (versioned workflows with running instances, tenant safety of activities,
domain guards, recovery after a worker or server kill)?

## Method

The behaviour that does not depend on Temporal was built behind a port, `OrchestratorPort`
(`packages/kernel/src/orchestrator.ts`), with an in-process adapter (`apps/api/src/modules/orchestration/`). A Temporal
adapter must pass the same suites.

## What ran here

- AC-1 (versioning): an instance started on version 1 keeps following version 1 (signal `approve`) after version 2 is
  registered with a different signal; a new instance follows version 2; neither is left stuck. A version not newer than
  a registered one is refused (`WORKFLOW_DEFINITION_INVALID`).
- AC-2 (tenant safety): a signed context whose tenant was changed is refused with 400 `TENANT_CONTEXT_INVALID` on
  start, signal and describe; the activity is never called. A test on the real database (activities insert an
  organisation unit under the verified context) shows one row for the right tenant, none for another, and zero rows
  for a tampered token.
- AC-3 (domain guard): a signal the guard refuses gives 403 `SCOPE_DENIED` and the instance keeps waiting; a signal the
  state does not accept gives 409 `WORKFLOW_STATE_INVALID`; of two concurrent decisions exactly one wins; an activity that
  fails (also after its database write: the transaction rolls back) leaves the state unchanged.
- An instance of another tenant is not found (404 `RESOURCE_NOT_FOUND`).

## Evidence

Kernel: 15 tests in `packages/kernel/test/orchestrator.test.ts` (`orchestrator.ts` 97.6% lines). API: 18 tests in
`apps/api/test/orchestration/` (11 adapter, 4 on the real database, 3 module wiring), run with
`npm run test:lane -- db npm test -w @machvon/api -- orchestration`.

## What did not run and why

Temporal itself: not installed, no Docker. Not measured: worker kill, server restart, persistence restore, upgrade with
long-running instances, the operations burden of self-hosting. The in-process adapter keeps instances in memory, so it
proves the contract and the guards, not durability. Declared but not entered: `infra/components/temporal.json` is
`PLANNED` with `docs/runbooks/infra/temporal.md`; the entry gate fails until a restore test is recorded.

## Decision

Keep the single-orchestrator decision (R9) provisionally: the product depends on the port, so the engine can still be
replaced. The decision is **not confirmed operable**. Owner: platform tech lead. To run it: deploy Temporal on its own
PostgreSQL, write the Temporal adapter, run the same contract suites against it, then run the three drills (worker kill,
server restart, persistence restore) and record times here.
