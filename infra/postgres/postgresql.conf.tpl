# PostgreSQL template for the primary and the standby (ST-KERNEL-040). Values in ${...} come from the environment.
wal_level = logical
archive_mode = on
archive_timeout = 60s
archive_command = 'pgbackrest --stanza=${STANZA} archive-push %p'
max_wal_senders = 10
max_replication_slots = 10
synchronous_standby_names = 'ANY 1 (standby1)'
shared_buffers = ${SHARED_BUFFERS}
max_connections = ${MAX_CONNECTIONS}
