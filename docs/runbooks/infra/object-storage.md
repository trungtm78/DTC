# Runbook: object storage

Story: ST-KERNEL-024. Declaration: `infra/components/object-storage.json`; alert rules `infra/alerts/object-storage.json`.

S3-compatible storage in Vietnam. Primary in VN-HAN-1, asynchronous replica in VN-SGN-1. Objects are encrypted with the
tenant key; the database keeps the checksum and the object key.

## Entering use

The component stays `PLANNED` until `npm run infra:check -- --require-entered object-storage` passes: this runbook,
the alert rules and a restore test (delete an object, restore it from the replica, compare the checksum). See
[README](README.md).

## Write errors

Alert `objects-write-errors`: the write error rate is above 1%.

1. Check the storage endpoint health and the credential in use; a rotated credential not yet distributed is the usual cause.
2. Check free capacity and the per-tenant quota (a quota error is a product limit, not an outage).
3. Uploads that failed leave no database row (the row is written after the checksum is confirmed); retry from the client.

## Replication

Alert `objects-replication-lag`: the replica is more than 15 minutes behind.

1. Look at the replication queue on the primary and the network path VN-HAN-1 to VN-SGN-1.
2. While the lag lasts the second site does not have the newest objects: tell the incident owner, as it spends the RPO.
3. After repair, list objects missing on the replica and let the replication job copy them; compare counts and checksums.

## Restore

Restore from the replica into a new bucket, then switch the endpoint. Verify with the checksum column of the file table.
