# PROVISIONING_FAILED

**Owner:** platform-oncall · **Severity:** critical · **Rule:** `alerts/rules/PROVISIONING_FAILED.json`

## What it means

A tenant that was requested is not usable: the saga stopped at the step named in the metric label and waits for a retry.

## What to do

1. Read `tenant_provisioning_failed_total{step}` and the provisioning state of the tenant in the registry.
2. Fix the cause (infrastructure port, identity provider), then retry with `retryTenantProvisioning`.
3. The requester sees the tenant as provisioning until the retry succeeds.
