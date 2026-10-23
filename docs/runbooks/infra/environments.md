# Environments

| Environment | Purpose | Data | Notes |
|---|---|---|---|
| `local` | developer machine | synthetic | embedded PostgreSQL, no external services |
| `ci` | pipeline runs | synthetic | throw-away databases per job |
| `test` | shared integration | synthetic | provider sandboxes |
| `staging` | same configuration as production; migration and recovery rehearsals; UAT | synthetic or masked | masked refresh from production needs the Data Owner's approval and the `masked` flag |
| `production` | real tenants | real | first cohort is the pilot |
| `dr` | second site; receives WAL and backups; rehearsals and disasters | real | brought up on demand |

Rules enforced by `npm run infra:check`:

- every resource, replica, log sink and telemetry endpoint is in a Vietnamese region (VN-HAN-1, VN-SGN-1, VN-DAD-1);
  `local` and `ci` use the region `local`;
- `staging`, `production` and `dr` have a backup target in a different region from the primary database;
- an egress target outside Vietnam is refused unless it carries only PUBLIC data with an approved transfer assessment;
- credentials, KMS key and Keycloak realm are different in each environment;
- real data exists only in `production` and `dr`.
