# KERNEL-002: PowerSync on PostgreSQL at a Vietnamese cloud

Status: **NOT RUN** (needs PowerSync, a PostgreSQL with logical replication at a candidate cloud, and a client).
Story: ST-KERNEL-002 (SPIKE-POWERSYNC).

## Question

Does the chosen domestic cloud allow `wal_level = logical` (or is PostgreSQL on a VM used), and do tenant- and
scope-parameterised sync rules deliver no row of another tenant and empty the bucket after a membership is revoked?

## Method

Planned, not executed: a PostgreSQL 16 or later instance with a `powersync` publication and the `machvon_sync`
replication role; two tenants of 20 projects each; one user of tenant A synced to a client; then a server-side
revocation while the device is offline.

## What ran here

Nothing of the spike itself. What exists in the repository and is relevant:

- `infra/postgres/postgresql.conf.tpl` sets `wal_level = logical`, and `npm run infra:check` fails if it is anything
  else. This declares the requirement; it does not prove a cloud accepts it.
- The role `machvon_sync` exists in the migrations; no publication is created yet (KERNEL-020 waits for this spike).
- `infra/components/powersync.json` and `docs/runbooks/infra/powersync.md` declare the component as `PLANNED`, with the
  `powersync-sync-lag` alert. The entry gate (AC-3) works: `npm run infra:check -- --require-entered powersync` fails
  because there is no restore evidence, and would pass once the runbook, the bucket-rebuild evidence and the alert exist.

## Evidence

AC-3 only: `scripts/infra-check.test.mjs` has the cases "the entry gate passes when the runbook, the restore evidence and
the alerts all exist" and "fails naming the missing runbook, restore test or alert, one at a time".

## What did not run and why

AC-1 (no rows of tenant B on the device) and AC-2 (empty bucket after revocation): there is no PowerSync service, no
candidate cloud account and no client here, and Docker is not installed. No isolation claim about sync is made.

## Decision

None yet. The offline architecture (A1) stays unproven; slices that depend on offline sync (MOB) must not start. Owner:
platform tech lead. To run it: provision the VM, set `wal_level = logical` from `infra/postgres/postgresql.conf.tpl`,
create the publication and `machvon_sync` grants, deploy PowerSync with sync rules parameterised by tenant and scope,
then run the two scenarios and record the result here; afterwards record the bucket-rebuild evidence and set the
component to `IN_USE`.
