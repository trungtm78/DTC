# Runbook: PowerSync

Story: ST-KERNEL-002, ST-KERNEL-045. Declaration: `infra/components/powersync.json`; alert rules `infra/alerts/powersync.json`.

PowerSync replicates the sync roles' view of PostgreSQL to mobile clients through a logical replication slot. It reads
through the `machvon_sync` role, which sees only what the sync rules allow.

## Entering use

The component stays `PLANNED` until `npm run infra:check -- --require-entered powersync` passes: this runbook, the
alert rules and a restore test (rebuild the service from the sync rules on a restored database and sync one client).
See [README](README.md).

## Sync lag

Alert `powersync-sync-lag`: sync lag is above 60 s for a bucket.

1. Check the logical slot on the primary (`pg_replication_slots`): an inactive slot retains WAL and fills the disk,
   see the disk section of the PostgreSQL runbook.
2. Check the service health and the sync role connection count.
3. If the slot cannot be recovered, recreate it; clients resynchronise from the server. Offline writes already queued on
   devices are not lost: they replay through the command pipeline with their idempotency keys.
