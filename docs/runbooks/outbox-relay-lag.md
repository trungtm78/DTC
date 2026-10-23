# Runbook: outbox relay lag and DEAD events

Story: ST-ADM-001. Table: `outbox_event`. Relay role: `machvon_outbox_relay`.

## Signals

- Gauge `outbox_oldest_pending_seconds`: age of the oldest `PENDING` event. Alert `OUTBOX_LAG` when it exceeds 300 seconds. The alert goes to the operations channel, independent of the notification module.
- Counter `outbox_dead_total`: events that failed 20 times and became `DEAD`.

## Lag (`PENDING` events getting older)

1. Check that the relay process is running and can connect with the relay role.
2. Look at the oldest events:
   ```sql
   select id, tenant_id, type, attempts, next_attempt_at, last_error
     from machvon.outbox_event where status = 'PENDING' order by created_at limit 20;
   ```
   `last_error` holds only the error class name. Find the matching error in the relay log by event id.
3. A growing `attempts` with a future `next_attempt_at` means the consumer or broker is failing; backoff is `min(600, 2^(attempt-1))` seconds. Fix the consumer first, then the events are delivered on their own.
4. A relay that is up with no failing events but a large backlog needs more relay instances: batches use `FOR UPDATE SKIP LOCKED`, so instances never claim the same row.

## Alerts the relay and its consumers raise

| Alert | Raised by | Meaning | First action |
|---|---|---|---|
| `OUTBOX_LAG` | relay, after each batch | the oldest PENDING event is older than 300 s | follow "Lag" above |
| `OUTBOX_EVENT_DEAD` | relay, when an event uses its 20th attempt | the event will not be delivered without an operator (context: event id, tenant id, type, attempts) | follow "DEAD events" below |
| `OUTBOX_CONTEXT_TAMPERED` | consumer (`consumeOnce`), before any database access | the signed tenant context of a delivery does not verify, expired, or names another tenant than the delivery (context: event id and `INVALID_TOKEN` or `TENANT_MISMATCH`, never the token) | treat as a security incident: check that relay and consumer share the same signing key, that no process rewrites deliveries, then inspect who published the event |

A key mismatch between relay and consumer after a deployment shows up as `INVALID_TOKEN` for every event; a single `TENANT_MISMATCH` is never a configuration fault.

## DEAD events

1. List them: `select id, tenant_id, type, attempts, last_error from machvon.outbox_event where status = 'DEAD';`
2. Fix the cause. Delivery is at least once and consumers deduplicate by event id, so replay is safe.
3. Replay as the owner role: `update machvon.outbox_event set status = 'PENDING', attempts = 0, next_attempt_at = now() where id = '<id>';`
4. Record the cause and the replayed ids in the incident ticket.

## Expired idempotency rows

The hourly job calls `IdempotencyStore.purgeExpired` for each tenant; a growing `idempotency_record` table means that job stopped.
