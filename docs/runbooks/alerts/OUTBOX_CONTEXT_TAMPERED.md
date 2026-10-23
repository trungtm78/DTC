# OUTBOX_CONTEXT_TAMPERED

**Owner:** security-oncall · **Severity:** critical · **Rule:** `alerts/rules/OUTBOX_CONTEXT_TAMPERED.json`

## What it means

The signed tenant context of an outbox delivery was invalid or named another tenant: either the signing key differs between nodes or something altered a delivery. Treat it as a security incident until proven otherwise.

## What to do

1. Check that every node has the same `OUTBOX_SIGNING_KEY` (a rotation in progress is the benign cause).
2. If the keys agree, treat it as tampering: preserve the `outbox_event` row and the audit trail, and open a security incident.
3. The context reason in the alert (`TENANT_MISMATCH`, `INVALID_TOKEN`) tells which check failed; it never contains the token.
