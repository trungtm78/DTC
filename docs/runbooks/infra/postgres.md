# Runbook: PostgreSQL

Story: ST-KERNEL-020, ST-KERNEL-040. Declaration: `infra/components/postgres.json`, `infra/postgres/`.
Alert rules: `infra/alerts/postgres.json`, all routed to the independent `ops-pager` channel.

PostgreSQL 18 is self-hosted in Vietnam: primary and synchronous standby in VN-HAN-1, WAL archive and the daily full
backup in VN-SGN-1 (the second site). Targets: RPO 15 minutes, RTO 4 hours, point-in-time recovery for 35 days.

## Entering use

The component stays `PLANNED` until `npm run infra:check -- --require-entered postgres` passes: this runbook, the
alert rules, and a restore test recorded for the current major version (see [README](README.md)). A major upgrade
makes the old evidence stale; repeat the restore test on the new version first.

## Failover

Alert `pg-replication-lag`: the standby is more than 60 s behind for 5 minutes.

1. Check `pg_stat_replication` on the primary: is the standby connected, and is the lag in sent, write or replay?
2. A replay lag with a long-running query on the standby: cancel the query; replication catches up.
3. A broken connection or a full disk on the standby: fix it, or rebuild the standby from the latest backup.
4. Switchover (planned, or when the primary is lost) must complete within 15 minutes: promote the standby, move the
   virtual address, confirm the application connects, then rebuild the old primary as the new standby.
5. After any promotion, take a full backup and confirm the WAL archive continues from the new timeline.

## WAL archive

Alert `pg-wal-archive-failure`: `archive_command` is failing, or the last archived WAL is older than 120 s. This is a
P1 because it spends the RPO.

1. `SELECT * FROM pg_stat_archiver` shows the last failure and the last success.
2. Check the second site: network path VN-HAN-1 to VN-SGN-1, the bucket, the credentials (rotated recently?).
3. Do not delete WAL on the primary to free disk before the archive catches up; that breaks point-in-time recovery.
4. When the archive is back, confirm `archive_timeout` is still 60 s and the lag is shrinking.

## Disk

Alert `pg-disk`: the data or WAL volume is above 80%. Find the growth first (`pg_total_relation_size`, replication
slots that retain WAL, a stuck archive). Extend the volume before cleaning. Never drop a replication slot a live
consumer (PowerSync, the outbox relay) still uses without telling its owner.

## Connections

Alert `pg-connections`: more than 80% of `max_connections`. Look at `pg_stat_activity` grouped by role and state: an
application pool leak shows as `idle in transaction`. Terminate only the offending sessions; raise the limit only
after the pools are sized.

## Backup

Alert `pg-backup-age`: the last successful full backup is older than 26 hours.

1. Read the pgBackRest log of the last run and fix the cause (disk, credentials, network to the second site).
2. Run the backup by hand and confirm it appears in `pgbackrest info`.
3. A restore drill is run quarterly on a clean host. Verify the checksum, the row counts, the file references and the
   money total, then write the evidence file named in the component declaration.

## Restore

1. Stop writers. Choose the target time (before the incident) and the backup that precedes it.
2. `pgbackrest restore --type=time --target=<timestamp>` on a clean host in VN-SGN-1.
3. Start, check `pg_is_in_recovery()`, run the integrity checks of the backup drill, then point the application at it.
4. Record the elapsed time; it must stay within the 4 hour RTO.
