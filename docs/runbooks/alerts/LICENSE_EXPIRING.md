# LICENSE_EXPIRING

**Owner:** platform-oncall · **Severity:** warning · **Rule:** `alerts/rules/LICENSE_EXPIRING.json`

## What it means

The tenant keeps working until the license ends, then the entitlements stop. Renewal needs a commercial decision, not an operational one.

## What to do

1. Take the tenant id and the days left from the alert context.
2. Tell the account owner; a renewal is a new `post_licenses` for the same tenant.
3. The alert repeats on each run until the license is renewed or ends.
