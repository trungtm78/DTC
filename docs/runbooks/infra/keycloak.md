# Runbook: Keycloak

Story: ST-IAM-002. Declaration: `infra/components/keycloak.json`, `infra/keycloak/realm-template.json`; alert rules
`infra/alerts/keycloak.json`.

One realm per environment (`machvon-<env>`). The `machvon-control` client has its own audience and requires WebAuthn
for SystemAdmin, PlatformOperator, BillingOperator and SupportOperator.

## Entering use

The component stays `PLANNED` until `npm run infra:check -- --require-entered keycloak` passes: this runbook, the
alert rules and a restore test (import the last realm export into an empty instance and log in). See [README](README.md).

## Failed logins

Alert `keycloak-login-failures`: 10 failed logins came from one source within 5 minutes.

1. Separate a credential-stuffing pattern (many users, few attempts each, one source) from a broken client (one client,
   every user): check the event log by client and by IP.
2. For an attack, tighten the brute-force detection settings and block the source at the edge; notify security administration.
3. For a broken client, check the redirect URIs and the secret reference after the last rotation.

## Export

Alert `keycloak-realm-export-age`: the last realm export is older than 24 hours.

1. Run the export job by hand and check the file lands in the second site.
2. Exports contain no user passwords or secrets (secrets are `secret://` references); store them with the same
   retention as the database backups.

## Restore

Import the realm export into a new instance, restore the Keycloak database from the PostgreSQL backup, verify one login
per client, then switch the address.
