# KERNEL-006: Vietnamese cloud RPO and RTO of PITR, WAL archive and S3-compatible storage

Status: **NOT RUN** (needs candidate cloud accounts).
Story: ST-KERNEL-006 (SPIKE-CLOUD-RPO-RTO).

## Question

Do real PITR, WAL archive and S3-compatible versioning and replication at the candidate domestic clouds meet RPO 15
minutes and RTO 4 hours (D10), with every resource, backup target and log sink in Vietnam and the second site in a
different data centre?

## Method

Planned, not executed: a seeded PostgreSQL with a continuous writer and `archive_timeout = 60s`; destroy the primary;
restore by PITR into the second site; time it; compare checksums, row counts and file references against the source and
the object-storage replica; check the cloud inventory against the residency list.

## What ran here

Nothing measured. The targets and the residency rules are declared and checked as data, so the spike has a fixed
yardstick:

- `infra/postgres/backup.json`: RPO 15 minutes, RTO 4 hours, PITR retention 35 days, WAL archive to the backup target
  with `archiveTimeoutSeconds` 60; `infra/postgres/postgresql.conf.tpl`: `archive_timeout = 60s`, `wal_level = logical`.
- `infra/policies/residency.json` and `infra/environments/*.json`: only VN-HAN-1, VN-SGN-1, VN-DAD-1; staging, production
  and dr must have a backup target in another region than the primary; foreign egress only for PUBLIC data with an
  approved assessment. `npm run infra:check` enforces this (AC-2 for the declaration, not for a real inventory).

## Evidence

`scripts/infra-check.test.mjs` (20 tests; `infra-check.mjs` 97% lines) covers the residency, second-site, archive-timeout,
WAL-level and recovery-target rules. They validate the declaration; no cloud was queried.

## What did not run and why

AC-1 (data-loss window and restore time), AC-3 (checksums, counts, dangling references after a restore) and the
real-inventory half of AC-2: no cloud account, no second site, no PostgreSQL primary and standby, no object storage.
The region names in `infra/` are placeholders for the candidates' real locations and must be replaced by the cloud
chosen.

## Decision

None yet; RPO 15 minutes and RTO 4 hours are neither confirmed nor adjusted. Owner: DevOps and security engineer. To run
it: for each of two candidate clouds, apply the declarations, run the seeded writer, destroy and restore, then fill a
table of cloud, loss window, restore time, replication lag and residency findings here; the best result sets the cloud,
and the restore evidence file named in `infra/components/postgres.json` is the first component entry for the gate.
