# AUDIT_CHAIN_BROKEN

**Owner:** security-oncall · **Severity:** critical · **Rule:** `alerts/rules/AUDIT_CHAIN_BROKEN.json`

## What it means

An audit window no longer matches its seal: audit rows were changed, removed or sealed out of order.

## What to do

1. Take the tenant id and window from the alert context and run `npm run jobs:run -- audit-verify`.
2. Preserve the database state before any repair; do not re-seal until the cause is understood.
3. Open a security incident: a broken chain is evidence handling, not a routine fault.
