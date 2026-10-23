# M2 (R0 foundation) alignment review against the original spec

Date: 2026-10-23. Read-only review (no code, database or browser run); evidence comes from the repository at HEAD
`e9c46be` (all file paths are relative to the repository root). Status words: DONE (every acceptance criterion has a
test), PARTIAL (something is built, something is missing), NOT STARTED.

Sources used: `Design/MACHVON_Design/03_Engineering/implementation_plan.json` (57 stories with release R0),
`01_Documents/04_Thiet_ke_co_ban.md` (the decision table D-B02..D-B12, K1..K9 and ledger R1..R11 are in its section
"Bảng quyết định baseline 1.4" and its CI/CD section; the file `C:/Users/PNE_AI_01/.claude/plans/pasted-content-...md`
named in the task only describes the DTC to PIS rename and holds no decisions), `05_modules/{IAM,ADM}.md`,
`schema_reference.sql`, `openapi.json`, `error_codes.json`, `nonfunctional_requirements.json`, the M2a to M2e plans and
the M3 roadmap. Acceptance ids (UAT-AC131 and the like) were searched in the code: only 23 of 196 R0 acceptance
criteria are named in a test, so coverage below was judged by reading the tests (finding F7).

## 1. R0 stories

Headline: **57 R0 stories: 7 DONE, 13 PARTIAL, 37 NOT STARTED.**

| Story | Status | Evidence / what is missing |
|---|---|---|
| ST-KERNEL-010 merge gates | DONE | `scripts/architecture-check.test.mjs`; `ci/test/review-labels.test.mjs`, `ci/test/workflows.test.mjs`; design-check gate in `ci/` |
| ST-KERNEL-021 request pipeline | DONE | `apps/api/test/allowlist.pipe.test.ts`, `problem.filter.test.ts`, `packages/db/test/tenant-database.test.ts`, `scripts/lint-error-codes.test.mjs` |
| ST-KERNEL-023 audit immutability | DONE (window granularity) | `packages/db/test/platform-services-migration.test.ts`, `audit-tamper.test.ts`, `apps/api/test/command-pipeline.test.ts`; row localisation and alert routing logged in TODOS.md |
| ST-KERNEL-028 command contract | DONE (TK-4 deferred to M3) | `apps/api/test/command-pipeline.test.ts`, `apps/api/test/conformance/command-conformance.test.ts` |
| ST-KERNEL-111 web shell | DONE | route walk 406 routes x 2 widths, 0 broken (`apps/web/e2e/route-walk.spec.ts`; run manually, not in CI: F6) |
| ST-IAM-004 PDP | DONE (transports pending) | `apps/api/test/policy-guard.test.ts`, `apps/api/test/authz/revocation-lag.test.ts`, `packages/kernel/test/{decision,pdp.property}.test.ts`; `iam.access.changed.v1` is not delivered to `onAccessChanged` yet |
| ST-ADM-001 idempotency, outbox | DONE | `packages/db/test/{idempotency-store,outbox,outbox-relay,consumer-inbox,delivery-recovery}.test.ts`, `apps/api/test/command-pipeline.test.ts`; hourly purge job exists as `purgeExpired` but is not scheduled |
| ST-KERNEL-013 supply chain | PARTIAL | `npm audit` in `.github/workflows/ci.yml`; no SBOM, no image scan |
| ST-KERNEL-020 migration V1 | PARTIAL | roles, grants, ledger, checksum tests exist; RLS catalog test on the migrated database, upgrade-from-previous-version test and the `machvon_sync` PowerSync publication are missing (F1, F3) |
| ST-KERNEL-022 signed worker context | PARTIAL | `packages/kernel/test/signed-context.test.ts`, `delivery-recovery.test.ts`; consumers do not use the signed context and no alert fires on a tampered context or a DEAD event (F4) |
| ST-KERNEL-024 cache, storage keys | PARTIAL | `packages/kernel/test/tenant-keys*.test.ts`; object storage prefixes, presigned URLs, upload validation missing |
| ST-KERNEL-026 isolation suite | PARTIAL | API and database channels in `apps/api/test/isolation/*`; cache, search, file, export, sync channels missing |
| ST-KERNEL-027 negative matrix | PARTIAL | `apps/api/test/authz/negative-matrix.test.ts` (7 commands x 14 roles, wrong tenant, control-plane audience); maker-checker and MFA replay cases missing |
| ST-KERNEL-030 contract-first | PARTIAL | `packages/contracts/test/*`, `packages/api-client/test/*`; Dart client and N versus N-1 breaking-change detection missing (F13) |
| ST-KERNEL-031 tokens and theme | PARTIAL | `packages/design-tokens/test/*`, web theme tests; Flutter ThemeData missing (M2e task 11), full-screen visual ratio not met (F5) |
| ST-IAM-001 tenant boundary | PARTIAL | `apps/api/test/isolation/isolation.test.ts`, tenant-keys tests; RLS catalog on the migrated DB and the alert on a tampered context missing |
| ST-IAM-005 unit-tree scopes | PARTIAL | reader limited to the caller subtree (`apps/api/test/org-units-commands.test.ts`); IAM-09 screen and the 5,000 unit / 50,000 grant performance test missing |
| ST-ADM-002 audit trail | PARTIAL | tamper and seal tests pass; seal every 5 minutes and verify hourly are not scheduled, so "alert within one hour" does not hold at runtime |
| ST-ADM-004 org unit tree | PARTIAL | backend and ADM-01 screen tested; the "UI-ADM-01 screen contract checks report 0 failures" tool was not identified or run |
| ST-ADM-005 roles and grants | PARTIAL | backend and ADM-03 screen tested; DB CHECK does not refuse `system.*` as AC-4 requires (F2); UI-ADM-03 contract check not run |
| NOT STARTED (37) | | DOC-001..005; KERNEL-001..006 (spikes), 011, 012, 014, 015, 025, 034, 040, 041, 042, 044, 050, 051; IAM-002, IAM-003; ADM-003, 006, 007, 008, 009; SAS-001..006; NOT-001 |

## 2. Acceptance criteria of the implemented stories

| AC | Covered by | Gap |
|---|---|---|
| KERNEL-010 #1, #2, #3 | architecture-check test; review-labels and workflows tests; designCheck stage | none (module graph rule is package-level, F9) |
| KERNEL-020 #1 | `Design/MACHVON_Design/work/tools` sql-verify (reference schema) | MISSING on the migrated product database (F1) |
| KERNEL-020 #2 | `packages/db/test/migrate.test.ts` (roles, INSERT/SELECT on `audit_event`) | `machvon_sync` publication part MISSING |
| KERNEL-020 #3 (OPS02) | second run and checksum tests only | MISSING upgrade from the previous version with seeded data (F3) |
| KERNEL-021 #1, #2, #3 | allowlist pipe test; tenant-database pool tests; error-code lint test | none |
| KERNEL-022 #1 | signed-context test (rejection) | MISSING: zero rows in tenant B end to end, alert |
| KERNEL-022 #2 | `delivery-recovery.test.ts` (relay killed at event 37, consumer at 61) | none |
| KERNEL-022 #3 | outbox-relay test marks DEAD after 20 | MISSING: DLQ alert with owner and runbook |
| KERNEL-023 #1, #2, #3 | platform-services-migration, audit-tamper, command-pipeline tests | #2 is window granularity (logged) |
| KERNEL-024 #1 | tenant-keys tests | #2, #3 MISSING |
| KERNEL-026 #1, #3 | isolation.test.ts (foreign id 404, every id-bearing operation needs a case) | #2 department / guest scope cases only partly (no project endpoints) |
| KERNEL-027 #1 | roles-and-grants test (SELF_GRANT_DENIED) | maker-checker (SELF_APPROVAL_DENIED) not applicable yet |
| KERNEL-027 #2 | negative-matrix control-plane audience case | control-plane token without step-up MISSING |
| KERNEL-027 #3 | none | MISSING |
| KERNEL-028 #1, #2, #3 | command-pipeline and conformance tests | none |
| KERNEL-030 #1, #3 | contracts lint tests (`missing_x_permission`, `dto_exposes_secret`) | #2 MISSING (response field rename, Dart round trip) |
| KERNEL-031 #2, #3 | design-tokens overlay tests; shell tenant-switch test | #1: Flutter and full-screen visual ratio MISSING |
| KERNEL-111 #1 | route walk report | not CI-gated |
| IAM-001 #1, #3, #4 | isolation test; tenant-keys; signed-context | #2 MISSING on the migrated DB; #4 lacks the alert |
| IAM-004 #1, #2, #3, #4 | policy-guard tests; revocation-lag test | none (lag measured in-process) |
| ADM-001 #1, #2, #3, #4 | idempotency-store, command-pipeline, delivery-recovery tests | none |
| ADM-002 #1 | audit-tamper, audit-seal-job (1,000 rows) | "within one hour" needs scheduling |
| ADM-002 #2 | command-pipeline denied test | none |
| ADM-004 #1, #2 | org-unit-tree and org-units-commands tests | none; #3 contract check not run |
| ADM-005 #1, #2, #3, #5, #6 | roles-and-grants and anti-escalation tests | none |
| ADM-005 #4 | anti-escalation tests, API test | DB CHECK refusing `system.*` MISSING (F2) |

## 3. Deviations of the code from the spec

| # | Deviation | Spec reference | Severity | Logged? |
|---|---|---|---|---|
| F1 | RLS completeness is checked only on the design reference schema (sql-verify), not on the product migrations; the planned `rls-report` / `index-report` / `rls-catalog.test.ts` (M2a plan task 4) do not exist although PROGRESS.md lists "test RLS catalog" as done; V003 and V004 change policies and constraints outside sql-verify | KERNEL-020 AC-1, IAM-001 AC-2, 04 CI/CD "kiểm RLS catalog" | P1 | NEW (PROGRESS claim inaccurate) |
| F2 | `role_definition` CHECK lists 4 exact permissions; the catalogue has 7 `system.*` permissions (`system.tenant.read`, `system.support.request`, `system.release.manage` are not covered) and patterns such as `system.*` pass | ADM-005 AC-4, BR-IAM-05(e) | P1 | NEW |
| F3 | No upgrade test "from the previous version with seeded data" and no expand-contract check | KERNEL-020 AC-3, 04 CI/CD migration test | P2 | NEW |
| F4 | Outbox consumers trust `delivery.tenantId` (`consumeOnce`) instead of a signed tenant context; no alert on a tampered context or a DEAD event (only metrics and the `OUTBOX_LAG` alert) | KERNEL-022 AC-1, AC-3, NFR-TENANCY-08 | P2 | NEW |
| F5 | Real ADM-01 and ADM-03 UIs replace the placeholder content of the mockup; extra field "Mã đơn vị" and the real actions are not in `screen_catalog.json` or the prototype; only frame regions are compared with the baseline PNGs (full-page ratio 0.0235 and 0.0267 versus the 0.1 percent target) | D-B11, R10, 06_UI_UX "Quy trình thêm màn hình và field mới", KERNEL-031 AC-1 | P2 | partly (runbook `docs/runbooks/web-e2e.md`), PO baseline approval NEW |
| F6 | Route walk, flows and visual specs are not part of CI or the pre-push gates | KERNEL-111 AC-1, KERNEL-031 AC-1 | P2 | NEW |
| F7 | Tests do not carry the acceptance or UAT ids (23 of 196 criteria named); no UAT-COVERAGE mapping | R11, protocol section 9 | P2 | roadmap kit K5 |
| F8 | Seal, verify, relay and purge jobs are callable functions only; alert routing missing | ADM-002 AC-1, ADM-001 TK-6 | P2 | logged (TODOS M2b carry-overs) |
| F9 | Module boundaries are package-level (`apps/*` / `packages/*`); the `modules/<code>/application/public/**` structure and the module graph rule of 04 do not exist | K1, NFR-OPERABILITY-02 | P2 (before M3) | roadmap kit K1 |
| F10 | `apps/api/src/main.ts` is a placeholder constant: the API has no bootstrap, config, health endpoint or authentication guard outside tests | R0 "Core API", KERNEL-014 | P2 | partly (IAM-002 deferred) |
| F11 | Row-level tamper localisation reports the seal window | KERNEL-023 AC-2 | P3 | logged |
| F12 | Spec inconsistency: header `Idempotency-Replayed` (BR-PLT-02, ADM-001) versus `Idempotent-Replayed` (KERNEL-028 AC-1); code uses the first | BR-PLT-02 | P3 | NEW |
| F13 | OpenAPI lint checks only `x-permission` and secret exposure, not Idempotency-Key, If-Match and Problem on every write operation; no response-schema validation; no N versus N-1 diff | 04 CI/CD OpenAPI lint, KERNEL-030 AC-2 | P3 | N-1 diff logged, rest NEW |
| F14 | List reads return `{items, next_cursor}` without `snapshot_id` and `as_of` (optional in `openapi.json`) | openapi list schema | P3 | NEW |
| F15 | 14 system roles seeded where TK-IAM-004-1 says 13 (the IAM.md table has 14 codes) | IAM.md section 2 | P3 | logged as "14", inconsistency NEW |
| F16 | The server sends `error.<CODE>.title` keys but the web catalogues hold no `error.*` entries (screens map codes themselves) | 06 UI (no hard-coded strings), problem filter | P3 | NEW |
| F17 | PROGRESS.md has the M2c line twice; design prose says `audit_entry`, schema says `audit_event` (code comment only) | protocol section 7 | P3 | NEW |
| F18 | `machvon_sync` publication (PowerSync) absent | KERNEL-020 AC-2, NFR-TENANCY-07 | P3 (scope) | NEW |

Items already logged and not repeated: V003 outbox policy narrowing, `membership.scope_version`, unique active grant,
system role matrix sign-off (SPECIALIST, INVESTOR_OFFICER empty), contract status list for guests.

## 4. NFR coverage of the implemented parts

| NFR | Status | Gap |
|---|---|---|
| TENANCY-01 API, -02 RLS, -03 cache keys | covered (isolation suite, RLS in schema, tenant-keys) | -02: F1; Redis server not present |
| TENANCY-04 search, -05 object storage, -06 export, -07 PowerSync | NOT STARTED | KERNEL-024/025, PowerSync |
| TENANCY-08 signed context | PARTIAL | F4 |
| TENANCY-09 unit-tree scopes | PARTIAL | org units yes; project and contract resources not built |
| SECURITY-01 anti-escalation, -04 idempotency, -05 If-Match, -08 no generic writes, -11 audit | covered | -11 window granularity |
| SECURITY-02 control plane, -03 MFA and session | PARTIAL | plane and step-up checks only; no sign-in, TOTP, replay protection |
| SECURITY-06 secrets, -07 supply chain, -12 upload checks | NOT STARTED / PARTIAL | `npm audit` only |
| OPERABILITY-02 gates | covered | F9 |
| OPERABILITY-03 migrations | PARTIAL | F3 |
| OPERABILITY-05 outbox/inbox | covered | DLQ alert (F4) |
| OPERABILITY-04 Temporal, -06 imports | NOT STARTED | R1 and later |
| OBSERVABILITY-01 telemetry, -02 alerts | PARTIAL | sink ports, metric names, two runbooks; no OpenTelemetry, no alert routing |
| PERFORMANCE-01..04 | NOT STARTED | decision p95 below 20 ms test missing (IAM-005 AC-4) |
| RETENTION-02 legal hold | NOT STARTED | ADM-003 |

## 5. Decisions D-B02..D-B12, K1..K9 and ledger R1..R11

| Item | Conformance |
|---|---|
| D-B02 agents write code, humans review | followed (protocol); review-label gate in CI |
| D-B03 Vietnamese cloud | not exercised (no infrastructure yet) |
| D-B05 Codex review per slice | followed per task (commit-level reviews); evidence is in commit history and PROGRESS only |
| D-B07 stack | NestJS, React/Vite, PostgreSQL RLS, outbox: yes; Redis (port only), Keycloak, Temporal, PowerSync: not yet |
| D-B11 mockup binding | shell and tokens reuse the prototype CSS through an alias, frame regions at ratio 0; content deviation F5 |
| D-B12 Flutter | not started (M2e task 11) |
| K2 `SET LOCAL` per transaction | yes (`TenantDatabase`, `set_config(..., true)`) |
| K3 domain commands and DTO allowlist | yes (`@Command`, reads with explicit columns) |
| K4 audit and outbox in one transaction | yes |
| K5/R9 Temporal single owner | not started |
| K7 Keycloak | port design only |
| K9 OpenTelemetry | not started (F-level gap in section 4) |
| R1 infrastructure per slice | n/a yet |
| R2 human gates | yes (`ci/review-labels`) |
| R4 legal rules as data | not started (KERNEL-060/110, R1) |
| R6 tenant = managing agency | yes for org units under a tenant; registry not built |
| R7 ledger, R8 DOC | not started |
| R10 new screens drawn in the prototype | not followed for ADM-01/03 (F5) |
| R11 traceability | not followed at test level (F7) |

## 6. Prioritised fix list (contradictions, not unbuilt scope)

1. **F1 (P1):** add `rls-report` and `index-report` with `packages/db/test/rls-catalog.test.ts` over the fully migrated database (V001..V006) as in the M2a plan task 4; correct the M2a line of PROGRESS.md until it exists.
2. **F2 (P1):** new hand-written migration: CHECK on `role_definition.permissions` refusing any element starting with `system.` (for example `array_to_string(permissions, ',') !~ '(^|,)system\.'`), with a test for a pattern and for the 3 missing permissions; log a change request.
3. **F4 (P2):** carry a signed tenant context in `OutboxDelivery` and make `consumeOnce` verify it; raise `TENANT_CONTEXT_TAMPERED` and `OUTBOX_DEAD` alerts through `AlertSink`; test both.
4. **F3 (P2):** migration test that applies V(n-1) with seeded data, then V(n), asserting zero data loss and the consistency tool result.
5. **F5 (P2):** run the R10 process for ADM-01/03: draw the real UI into `02_Prototype` and `screen_catalog.json` (add the "Mã đơn vị" field with its FR source), ask the PO to approve new baselines, then gate the full-page ratio.
6. **F6 (P2):** add the browser lane (route walk and visual regions) to CI as a separate job with the lock and memory limits, and to the release checklist.
7. **F7 (P2):** add the acceptance id to each covering test title (generator in kit K5) and produce `UAT-COVERAGE.md`.
8. **F9, F10 (P2, before M3 slices):** module registry and module graph rule (kit K1); real `main.ts` bootstrap with config validation, health endpoints and the authentication guard from M2e.
9. **F8 (P2):** schedule the audit seal, verify, relay and purge jobs once a scheduler exists (Temporal schedules, KERNEL-044) or as an interim cron entry point.
10. **P3 batch:** F12 decide the replay header name and record it; F13 extend the OpenAPI lint; F14 add `snapshot_id` and `as_of`; F15 record the 13 versus 14 decision; F16 add a generated `error.*` catalogue to the web; F17 clean PROGRESS.md; F18 with PowerSync work.
