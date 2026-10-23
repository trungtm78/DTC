# ACCESS_REVOCATION_LAG

**Owner:** security-oncall · **Severity:** critical · **Rule:** `alerts/rules/ACCESS_REVOCATION_LAG.json`

## What it means

NFR: a revocation must take effect within 60 seconds on every node. A slow lag means a node keeps a stale access cache or misses the scope version change.

## What to do

1. Check the `access-cache-expiry` job and the scope version of the membership in question.
2. Look for a node that is not receiving cache invalidations (restart it to drop its cache).
3. Until the lag is below 60 seconds, treat revocations of sensitive grants as incomplete.
