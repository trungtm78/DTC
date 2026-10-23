# AUTHZ_DENY_SPIKE

**Owner:** security-oncall · **Severity:** warning · **Rule:** `alerts/rules/AUTHZ_DENY_SPIKE.json`

## What it means

A burst of denied requests: a misconfigured client, a role change that removed access, or someone probing for access.

## What to do

1. Group the DENIED audit events of the period by `actor_id` and `operation` to see whether one caller or one operation dominates.
2. One caller on many operations suggests probing: follow the security incident procedure.
3. Many callers on one operation suggests a role or grant change: check the latest role and grant commands.
