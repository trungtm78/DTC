# Runbook: Redis

Story: ST-SAS-001. Declaration: `infra/components/redis.json`; alert rules `infra/alerts/redis.json`.

Redis holds only reconstructible data (cache, rate-limit counters). Nothing that is a source of truth may live only in
Redis; losing the instance must cost latency, not data.

## Entering use

The component stays `PLANNED` until `npm run infra:check -- --require-entered redis` passes: this runbook, the alert
rules and a restore test (start an empty instance and show the product still answers, with cold caches). See
[README](README.md).

## Memory

Alert `redis-memory`: used memory above 80% of `maxmemory`.

1. Check the largest key patterns; a tenant key space growing without expiry is the usual cause.
2. Every key carries a TTL and the tenant id in its name; fix the writer, then flush only that pattern.
3. Raising `maxmemory` is the last step, not the first.
