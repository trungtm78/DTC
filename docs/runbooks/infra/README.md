# Infrastructure runbooks

The infrastructure is declared as data under `infra/` and checked by `npm run infra:check` (part of `npm run lint`).
Nothing in `infra/` provisions anything: it states what a provisioner must create and what the checks refuse.

| Path | What it declares |
|---|---|
| `infra/policies/` | data residency (Vietnamese regions only), egress rules, secret, pipeline, PostgreSQL and alert limits |
| `infra/environments/` | the six environments, their resources, regions and separate credentials, key and realm |
| `infra/components/` | each component: version, state (`PLANNED` or `IN_USE`), runbook, alerts, restore evidence, first stories |
| `infra/alerts/` | alert rules: owner, runbook anchor, the independent `ops-pager` channel |
| `infra/secrets/` | `secret://` references with owner and rotation days; never a value |
| `infra/pipelines/` | CI, staging and production pipelines (approval, canary by cohort, rollback) |
| `infra/postgres/`, `infra/keycloak/` | the PostgreSQL configuration template and backup targets; the realm template |

Environment guide: [environments.md](environments.md). Rotation: [secrets-rotation.md](secrets-rotation.md).
Releases: [rollback.md](rollback.md).

## The entry gate (ST-KERNEL-015)

A component may only move from `PLANNED` to `IN_USE` when all three exist:

1. its runbook (the file named in `runbook`);
2. a restore test recorded as evidence for the current version: `restoreEvidence.path` points at an existing file and
   `restoreEvidence.verifiedVersion` is not older than `version`;
3. its alert rules, defined in `infra/alerts/`.

`npm run infra:check` lists, for every component not yet entered, what is missing and which first stories it blocks.
`npm run infra:check -- --require-entered <component>` fails until the component is entered; a story that needs the
component runs it first.

## Restore evidence

Copy the template below to `docs/runbooks/infra/evidence/<component>.md` after a real restore on a clean host, and set
`state`, `restoreEvidence.path`, `verifiedVersion` and `restoredAt` in the component file in the same commit.

```
# Restore evidence: <component> <version>

- Restored at: <date>
- Component version restored: <version>
- Backup or export used: <identifier, age>
- Clean host: <where>
- Elapsed time: <minutes> (target: <RTO>)
- Checks run and results: <checksum, counts, references, application smoke>
- Performed by / witnessed by: <names>
```

Evidence is a record of something that happened. Do not write it before the restore.
