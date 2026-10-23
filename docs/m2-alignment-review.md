# M2 (R0 foundation) alignment review against the original spec

First review: 2026-10-23, read-only, at HEAD `e9c46be`. Final milestone gate: section 1 and section 7 were recomputed at HEAD
`37b015a` (all file paths are relative to the repository root). Sections 2 to 6 are the first review and are kept as the
record of what was found; section 7 says what has changed since, what remains, and what must be fixed.

Sources used: `Design/MACHVON_Design/03_Engineering/implementation_plan.json` (57 stories with release R0),
`01_Documents/04_Thiet_ke_co_ban.md` (the decision table D-B02..D-B12, K1..K9 and ledger R1..R11 are in its section
"Bảng quyết định baseline 1.4" and its CI/CD section), `05_modules/{IAM,ADM,SAS,DOC,NOT}.md`,
`schema_reference.sql`, `openapi.json`, `error_codes.json`, `nonfunctional_requirements.json`, the M2a to M2f plans and
the M3 roadmap.

## 1. R0 stories (recomputed at the M2 milestone gate)

Recomputed at HEAD `37b015a` from the repository, against `Design/MACHVON_Design/03_Engineering/implementation_plan.json`
(release R0, 57 stories, 196 acceptance criteria). Vocabulary: **DONE** (every criterion has a live test), **DONE_UNCONFIRMED**
(every criterion has a live test, a legal basis in `legal_confirmation_ledger.json` is not confirmed), **DONE_PENDING_ENV** (every
in-repo criterion has a live test; the criteria that only an external system can prove are named in
`docs/story-status.json` under `externalChecks`), **PARTIAL** (something is built, the missing items are listed),
**NOT STARTED**. A criterion is covered when a live test title carries its id (`node scripts/uat-trace.mjs`, output
`docs/UAT-COVERAGE.md`); the gate `npm run uat:check` enforces DONE, DONE_PENDING_ENV and DONE_UNCONFIRMED stories.

Headline: **57 R0 stories: 21 DONE, 2 DONE_UNCONFIRMED, 19 DONE_PENDING_ENV, 15 PARTIAL, 0 NOT STARTED**
(the review of 2026-10-23 at `e9c46be` said 7 DONE, 13 PARTIAL, 37 NOT STARTED; the plan header at `ca54b7b` said 11, 15, 31).

- Criteria named in a live test title: **156 of 196** (23 of 196 at the first review). The 40 others: 20 are declared external checks of DONE_PENDING_ENV stories, 20 sit in PARTIAL stories (listed below).
- Operations: of the 88 operation references of the R0 stories, 83 carry `@OperationId` and `acceptInvitation` is implemented as an identity command (`apps/api/src/session/accept-invitation.service.ts`); 4 are not implemented (the two outbox reads on purpose, the two tenant reads as duplicates). 43 of 574 write operations of the contract are commands.
- Screens: 24 of the 27 R0 screens exist (`apps/web/src/routes/screens/index.ts`); IAM-01, IAM-02, IAM-03 do not.
- Migrations: V001 to V021 (V005 retired in `db/migrations/blocks.json`).
- A DONE story still carries the cross-cutting caveats of section 7 (screen-contract tool, N5; the browser lane has not run on a hosted runner).

### DONE (21)

| Story | Criteria | Evidence | Caveat |
|---|---|---|---|
| ST-KERNEL-010 Repository conventions and merge gates: lint, types, coverage, arch... | 3/3 | scripts/architecture-check.test.mjs; ci/test/review-labels.test.mjs, workflows.test.mjs, verify.test.mjs | - |
| ST-KERNEL-015 Infrastructure entry gate: no self-hosted component is used without... | 2/2 | scripts/infra-check.test.mjs (entry gate, stale evidence); `npm run infra:check` passes and names the 8 components that have not entered | Every component is PLANNED with no restore evidence, so the gate correctly keeps the stories of those components waiting (see the DONE_PENDING_ENV rows) |
| ST-KERNEL-021 Kernel request pipeline: tenant transaction context, Problem+JSON, ... | 3/3 | apps/api/test/allowlist.pipe.test.ts; packages/db/test/tenant-database.test.ts; scripts/lint-error-codes.test.mjs | - |
| ST-KERNEL-022 Signed tenant context for workers, outbox consumers and Temporal ac... | 3/3 | packages/kernel/test/signed-context.test.ts; packages/db/test/consumer-inbox.test.ts, delivery-recovery.test.ts, outbox-relay.test.ts; alert rules OUTBOX_CONTEXT_TAMPERED and OUTBOX_EVENT_DEAD in alerts/rules | The Temporal activity part runs on the in-process orchestrator only (KERNEL-044); the API process passes the one alert sink to the relay and to every consumer (N1 fixed: `apps/api/test/workers/outbox-consumers.test.ts` shows `OUTBOX_CONTEXT_TAMPERED` leaving through it, `workers-runtime.test.ts` shows `OUTBOX_EVENT_DEAD`) |
| ST-KERNEL-023 Audit immutability conformance: grants, hash chain verification and... | 3/3 | packages/db/test/audit-writer.test.ts, audit-tamper.test.ts, platform-services-migration.test.ts; apps/api/test/command-pipeline.test.ts | AC-2 localises a tampered row to the seal window (F11); a change request for a per-row hash is logged |
| ST-KERNEL-028 Command contract conformance: Idempotency-Key replay and If-Match o... | 3/3 | apps/api/test/command-pipeline.test.ts; apps/api/test/conformance/command-conformance.test.ts | TK-4 (conformance over 10 commands of other modules) waits for M3 commands: 43 of 574 write operations exist |
| ST-KERNEL-034 Test data platform: fixture loader, synthetic data generator and ma... | 2/2 | packages/db/test/test-data.test.ts (fixture loader, synthetic tenant, keyed masking) | The data dictionary marks few columns PERSONAL as data; the masking rule list also matches column names (TODOS.md lane E) |
| ST-IAM-001 [FOUNDATION: TENANT-CONTEXT] Tenant boundary: tenant claim, SET LOC... | 4/4 | packages/db/test/rls-catalog.test.ts (all tenant tables of the migrated database); apps/api/test/isolation/*; packages/kernel/test/tenant-keys*.test.ts; consumer-inbox.test.ts | - |
| ST-IAM-003 [FOUNDATION: TENANT-SELECTION] Choose tenant and membership, issue ... | 3/3 | apps/api/test/session/select-tenant.test.ts; apps/web/src/screens/iam/TenantChooserScreen.test.tsx; apps/web/e2e/session-flows.spec.ts | - |
| ST-IAM-004 [FOUNDATION: PDP] Policy decision point, seeded role catalogue, sco... | 4/4 | apps/api/test/policy-guard.test.ts; apps/api/test/authz/revocation-lag.test.ts; packages/kernel/test/decision.test.ts, pdp.property.test.ts | Revocation lag is measured in process; the Redis and Keycloak transports of the access cache do not exist |
| ST-ADM-001 [FOUNDATION: IDEMPOTENCY-OUTBOX] Command pipeline: Idempotency-Key,... | 4/4 | packages/db/test/idempotency-store.test.ts, outbox*.test.ts, delivery-recovery.test.ts; apps/api/test/command-pipeline.test.ts | The two outbox reads of the story are not implemented on purpose (ADM.md section 7: the outbox is not exposed); change request pending. The hourly purge is started by the workers of the API process (N1 fixed; `docs/runbooks/jobs.md`, "In the API process") |
| ST-ADM-003 [FOUNDATION: LEGAL-HOLD] Legal hold service and purge guard | 2/2 | apps/api/test/legal-holds.test.ts; packages/db/test/legal-hold.test.ts; db/migrations/V013 | No retention job exists yet (R1), so the purge guard is proven on the idempotency purge and the technical tables |
| ST-ADM-004 Organisation unit tree: create, rename and move | 3/3 | apps/api/test/org-units-commands.test.ts; apps/web/src/screens/adm/OrgTreeScreen.test.tsx | The UI-ADM-01 screen-contract tool is not identified (N5) |
| ST-ADM-005 [FOUNDATION: ROLES-GRANTS] Roles and grants with anti-escalation | 7/7 | apps/api/test/roles-and-grants.test.ts; packages/kernel/test/anti-escalation.test.ts; packages/db/test/role-definition-system-permissions.test.ts (V007); RolesGrantsScreen.test.tsx | The UI-ADM-03 screen-contract tool is not identified (N5) |
| ST-ADM-008 Signing certificate registry (public certificates only) | 2/2 | apps/api/test/signing-certificates.test.ts; apps/web/src/screens/adm/CertificatesScreen.test.tsx; V014 | No Playwright visual case for ADM-08; the 30-day reminder notification is not sent (TODOS.md lane E2) |
| ST-SAS-002 [FOUNDATION: ENTITLEMENT] Minimal entitlement: plan features, entit... | 3/3 | apps/api/test/entitlements.test.ts; packages/db/test/entitlement-store.test.ts; packages/kernel/test/tenant-rate-limit.test.ts | - |
| ST-SAS-004 Suspend and resume a tenant with read-only mode | 3/3 | apps/api/test/tenant-state.test.ts; apps/web/src/screens/sas/TenantDetailScreen.test.tsx | x-events lists sas.entitlement.changed.v1, which suspending does not emit (TODOS.md lane A gaps) |
| ST-SAS-005 [FOUNDATION: THEME-SAS-04] Tenant theme and branding: draft, review... | 9/9 | apps/api/test/theme.test.ts, theme-assets.test.ts; packages/db/test/theme-store.test.ts; ThemeScreen.test.tsx; PublishedThemeProvider.test.tsx; V019 | Asset storage runs on the MOCK file adapter |
| ST-SAS-006 [FOUNDATION: PROVISIONING-COMPLETE] Complete the 11-step saga: enti... | 4/4 | apps/api/test/provisioning/provisioning-steps.test.ts, saga.test.ts; apps/api/test/tenant-owner.test.ts; ProvisioningRunScreen.test.tsx; apps/web/e2e/provisioning-flows.spec.ts | Steps 1 to 5 use MOCK ports for DNS, realm and storage (see SAS-001) |
| ST-NOT-001 [FOUNDATION: NOTIFICATION-CORE] Event to in-app notification with d... | 6/6 | apps/api/test/notifications/*; packages/db/test/notification-store.test.ts; InboxScreen.test.tsx, NotificationDetailScreen.test.tsx | Email and the other channels are R1 (OMNI) |
| ST-KERNEL-111 Web application shell: workspace navigation, route table from navig... | 1/1 | apps/web/e2e/route-walk.spec.ts (406 routes at 2 widths); .github/workflows/browser.yml | The browser workflow has not yet run on a hosted runner (the baselines come from Windows Chrome; TODOS.md R10 section) |

### DONE_UNCONFIRMED (2)

| Story | Criteria | Evidence | Unconfirmed basis and caveat |
|---|---|---|---|
| ST-DOC-001 Document anchor, versioned files and deterministic PDF render port | 3/3 | apps/api/test/doc/documents.test.ts, pdf-renderer.test.ts (golden SHA-256 of ND30_A4_STANDARD) | CXN-DOC-01 and CXN-DOC-03 unconfirmed. The scanner is the MOCK adapter; AC-2 cites INFECTED_FILE_BLOCKED, which the error registry does not hold (design gap 2 of the plan) |
| ST-DOC-003 PAdES verification library and signature report | 3/3 | apps/api/test/doc/pades-verifier.test.ts, signatures.test.ts (test CA created in the tests) | CXN-DOC-07 unconfirmed. Trust anchors come from a directory, not a per-tenant table (BR-DOC-15); no OCSP or CRL adapter, so revocation is UNKNOWN (TODOS.md lane D2) |

### DONE_PENDING_ENV (19)

Of these, KERNEL-002 and KERNEL-006 (and the real-system half of KERNEL-001, 003, 004, 005, DOC-004) are spikes whose experiment has not run; they are
DONE_PENDING_ENV only in the sense of the vocabulary (the in-repo criteria pass, the rest needs the named system). The release notes must not call them verified.
Owners and the command that runs each missing part are in `docs/spikes/README.md` and `docs/runbooks/infra/`.

| Story | Criteria | Evidence | External check outstanding |
|---|---|---|---|
| ST-DOC-004 Spike: real CA sandbox signing round trip and signing adapter port | 0/2 | docs/spikes/DOC-SPK-01.md; signing-port contract suite and MOCK adapter (apps/api/test/doc) | Needs a real CA sandbox: both criteria are declared external checks |
| ST-DOC-005 Outgoing document aggregate with leader signing, numbering by incre... | 5/5 | apps/api/test/doc/outgoing.test.ts; apps/web/e2e/outgoing-flows.spec.ts; V017 | Real CA round trip (the signer is the MOCK adapter). CXN-DOC-01 and CXN-DOC-04 are unconfirmed as well |
| ST-KERNEL-001 Spike 5: Flutter OIDC+PKCE, offline command queue, resumable checks... | 2/3 | packages/mobile-api-client/test/spike/*.dart (offline queue UNKNOWN then ACCEPTED; resumable upload with SHA-256); docs/spikes/KERNEL-001.md | AC-1 needs a Keycloak realm and a device. The 48 dp target of AC-3 conflicts with the 44 pt Apple minimum of the generated theme; the upload runs against a test double (no upload endpoint exists) (TODOS.md lane E2) |
| ST-KERNEL-002 Spike 2: PowerSync on PostgreSQL at a Vietnamese cloud, sync-rule i... | 1/3 | scripts/infra-check.test.mjs (entry gate only); docs/runbooks/infra/powersync.md | The experiment did not run: no PowerSync service, no cloud PostgreSQL. AC-1 and AC-2 are declared external checks |
| ST-KERNEL-003 Spike 1: PAdES leader signature, numbering by incremental update, o... | 1/3 | apps/api/test/doc/outgoing.test.ts (a provider failure keeps NUMBERED); docs/spikes/KERNEL-003.md | No CA sandbox and no second validator; AC-3 is satisfied by the spike report (a document, declared as such) |
| ST-KERNEL-004 Spike 3: domestic or self-hosted AI model quality and cost for tend... | 3/3 | scripts/ai-eval.test.mjs; scripts/ai-eval/harness.mjs (MOCK routes) | Harness only: no signed 60-item dataset and no provider keys, so no real score, latency or cost was measured. CXN-AI-01 unconfirmed |
| ST-KERNEL-005 Spike 4: self-hosted Temporal operations, workflow versioning and r... | 3/3 | apps/api/test/orchestration/*.test.ts; packages/kernel/test/orchestrator.test.ts (in-process adapter) | No Temporal server: instances live in one process and are forgotten on restart; the three failure drills did not run |
| ST-KERNEL-006 Spike 6: Vietnamese cloud RPO/RTO of PITR, WAL archive and S3-compa... | 0/3 | docs/spikes/KERNEL-006.md; targets and residency rules as checked data (`npm run infra:check`) | The experiment did not run: no cloud account. All three criteria are declared external checks |
| ST-KERNEL-011 Environments and infrastructure as code with Vietnamese data-reside... | 3/3 | scripts/infra-check.test.mjs (residency, egress, no shared credentials); infra/ declarations | Nothing was applied to a cloud and no egress log exists; CXN-13 unconfirmed. The plan wrote YAML, the files are JSON |
| ST-KERNEL-012 Secrets and key management with KMS or OpenBao, injection at runtim... | 1/3 | ci/test/scan.test.mjs (secret scan); infra/secrets/references.json (references only) | No KMS or OpenBao, no container image to inspect, no staging rotation: AC-2 and AC-3 are declared external checks |
| ST-KERNEL-020 Migration V1 generated from schema_reference.sql with database role... | 3/3 | packages/db/test/rls-catalog.test.ts, migration-upgrade.test.ts, migrate.test.ts; `npm run migrations:check`, `expand-contract:check` | The `powersync` publication and the SELECT-only grant of machvon_sync (AC-2) are in no migration; they wait for the PowerSync deployment (F18). `infra:check` lists the story as waiting for the postgres component |
| ST-KERNEL-024 Tenant-scoped cache keys, object storage prefixes with short-lived ... | 3/3 | packages/kernel/test/object-storage.test.ts, tenant-keys.test.ts; apps/api/test/files/files.test.ts; apps/api/test/isolation/channels.test.ts | No real S3-compatible store and no Vietnamese antivirus service: file system and EICAR MOCK adapters stand in. A bad presigned link answers 401 SIGNATURE_INVALID (no registered code for storage URLs) |
| ST-KERNEL-040 PostgreSQL production setup: standby, base backup, WAL archive to s... | 1/3 | scripts/infra-check.test.mjs (entry gate passes with runbook, evidence, alerts); docs/runbooks/infra/postgres.md | AC-1 and AC-2 need a primary, a standby, a WAL archive and a second site |
| ST-KERNEL-041 Object storage and Redis onboarding with runbooks, restore tests an... | 1/3 | packages/kernel/test/tenant-keys-lint.test.ts (raw cache access); docs/runbooks/infra/object-storage.md, redis.md | AC-1 and AC-2 need a versioned bucket with a replica and a staging Redis |
| ST-KERNEL-042 Keycloak infrastructure: realms per environment, control-plane clie... | 1/3 | scripts/infra-check.test.mjs (control-plane client audience, WebAuthn for platform roles); infra/keycloak/realm-template.json | AC-1 and AC-3 need a Keycloak instance and a paging channel |
| ST-KERNEL-044 Temporal production onboarding and the single-orchestrator pattern ... | 2/3 | apps/api/test/orchestration/in-process-orchestrator.test.ts; packages/kernel/test/orchestrator.test.ts | AC-3 needs Temporal persistence. The engine answers 409 WORKFLOW_STATE_INVALID where the story says TASK_ALREADY_DECIDED (the approval command keeps that code) |
| ST-KERNEL-050 Telemetry foundation: OpenTelemetry with tenant_id, a PII allowlist... | 2/3 | packages/kernel/test/telemetry.test.ts (allowlist, PII drop, trace through the outbox correlation id); apps/api/test/bootstrap.test.ts; docs/runbooks/api-runtime.md | AC-3 needs the telemetry stack. The OpenTelemetry SDK packages are not added (own tracer port with console and OTLP/HTTP JSON adapters), unlike the Decisions table of the M2f plan |
| ST-KERNEL-051 Alert framework: rules with owner and runbook, independent operatio... | 3/3 | packages/kernel/test/alerts.test.ts; scripts/alerts-check.test.mjs; alerts/rules (9 rules with owners and runbooks) | The on-call channel is a webhook port with a MOCK adapter (paging within 5 minutes cannot be shown); the API process hands `createAlertSink` to the relay, the seal job, the job runner and the consumers (N1 fixed); the revocation-lag metric has no production probe |
| ST-ADM-002 [FOUNDATION: AUDIT] Immutable audit trail with Merkle seals and ver... | 2/2 | packages/db/test/jobs.test.ts, audit-tamper.test.ts, audit-seal-job.test.ts; apps/api/test/command-pipeline.test.ts; docs/runbooks/jobs.md | The verify job detects a planted tamper within one run, and `npm start` now runs it hourly with the seal every 5 minutes (N1 fixed: `apps/api/test/workers/workers-runtime.test.ts` plants a tamper, the started verify job fails and raises `AUDIT_CHAIN_BROKEN`). The clause "within one hour" holds for a process that lives for an hour: the first run comes one interval after the start, and with several processes each job has one owner (advisory lock) |

### PARTIAL (15)

| Story | Criteria | Evidence | Exact missing items |
|---|---|---|---|
| ST-DOC-002 Number registers, document types and register ledger | 2/3 | apps/api/test/doc/registers.test.ts; packages/db/test/number-register-store.test.ts (50 numbers from 10 workers); DocumentTypesScreen, NumberRegistersScreen | AC-2: the register ledger export (43 rows, two-digit numbers, VOIDED and RECALLED labelled, SHA-256 and scope) is neither built nor tested. CXN-DOC-02 and CXN-DOC-04 unconfirmed |
| ST-KERNEL-013 Software supply chain: dependency audit for npm and pub, image scan... | 2/3 | scripts/supply-chain-check.test.mjs; scripts/sbom.test.mjs; docs/runbooks/supply-chain.md | AC-3: no daily scheduled audit with an alert and an owner (no workflow has a schedule trigger); no image scan and no pub audit; development dependencies carry a critical advisory (tinypool through vitest 4) |
| ST-KERNEL-014 Deployment pipeline: automatic staging, approved production, canary... | 0/3 | scripts/expand-contract-check.test.mjs; infra/pipelines; .github/workflows/deploy.yml | AC-1 to AC-3: the N versus N-1 compatibility suite, the rollback drill and the feature-flag service do not exist (the production pipeline lists a gate that no job runs) |
| ST-KERNEL-025 Search and vector projections filtered by tenant and ACL, and re-au... | 2/3 | apps/api/test/search.test.ts; apps/api/test/isolation/channels.test.ts; packages/kernel/test/scheduled-export.test.ts; packages/db/test/search-projection.test.ts | AC-3 (BI drill 403 SCOPE_DENIED) has no BI module to test against; the search projection has no writer; Vietnamese search does not fold accents |
| ST-KERNEL-026 Tenant isolation conformance suite across API, database, cache, sea... | 2/3 | apps/api/test/isolation/isolation.test.ts, suite.test.ts, channels.test.ts (API, database, cache, search, file, export) | AC-2 (department user, unit-tree user, contractor guest listing projects and contracts) has no project or contract endpoints to run on; the sync channel waits for PowerSync |
| ST-KERNEL-027 Authorization negative-test matrix generated from x-permission, plu... | 3/3 | apps/api/test/authz/negative-matrix.test.ts (roles x commands, wrong tenant, control plane, maker-checker, aal2 older than 15 minutes) | AC-3: the idle timeout and the replay of a rotated refresh token are not covered (session limits are not enforced, N2; refresh tokens belong to the identity provider). Maker-checker covers only releaseLegalHold, declared by hand |
| ST-KERNEL-030 Contract-first generation of server DTOs and TypeScript and Dart cl... | 2/3 | packages/contracts/test/* (lint, breaking-changes, compat, generate-dart); packages/mobile-api-client/test/*.dart | AC-2: no Dart contract test that fails on a renamed response field and round-trips fixture responses (the Dart client has typed requests only; the renamed-field check exists on the TypeScript side as `contracts:compat`) |
| ST-KERNEL-031 Design-token and tenant-theme pipeline for web CSS and Flutter Them... | 3/3 | packages/design-tokens/test/*; apps/web/src/shell/Shell.test.tsx; Dart theme tests | AC-1: the full-page visual difference is 0.9 to 4.3 percent against the 0.1 percent target for 24 screens; the baseline stays until the product owner decides (docs/r10-baseline-approvals.md, F5) |
| ST-IAM-002 Sign in, MFA and account recovery through Keycloak (OIDC code + PKCE) | 0/5 | OIDC verification, tenant token issue and aal2 claims (apps/api/src/auth); web OIDC client; infra/keycloak/realm-template.json | No test names any criterion. Screens IAM-01, IAM-02, IAM-03 are not built (24 of 27 R0 screens exist); lockout, neutral recovery answers and TOTP or WebAuthn are Keycloak behaviours and there is no Keycloak here |
| ST-IAM-005 Unit-tree scopes in the PDP and the "my effective access" screen | 2/4 | packages/db/test/scope-performance.test.ts (EXPLAIN plans use the path index; p95 under 100 ms on 5,000 units and 50,000 grants); apps/api/test/effective-access.test.ts; EffectiveAccessScreen.test.tsx | AC-1: no project resource to read inside and outside a subtree (the unit-level equivalent is in org-units-commands.test.ts). AC-4: the PDP decision p95 under 20 ms with the cache is not measured (the benchmark measures the scope queries) |
| ST-ADM-006 Members and invitations: invite, accept, suspend, end | 4/5 | apps/api/test/members.test.ts; V011; MembersScreen.test.tsx; apps/web/e2e/members-flows.spec.ts | AC-5: the members screen neither hides actions on higher ranks nor shows quota used and limit; the hourly job that expires pending invitations is not scheduled; the mail goes through a MOCK mailer |
| ST-ADM-007 Guest contractor memberships scoped to contracts | 2/3 | apps/api/test/guest-contractors.test.ts; GuestContractorsScreen.test.tsx | AC-2: nothing expires the guest grant on contract.closed (the CTR events do not exist yet, R1) |
| ST-ADM-009 Security policy versions: MFA roles, session limits, download TTL | 2/2 | apps/api/test/security-policies.test.ts (four eyes, publish); SecurityPolicyScreen.test.tsx; V014 | AC-1: no synchronisation of required actions to Keycloak and no "not yet applied at IdP" warning; session limits, IP allowlist and download TTL are validated but not enforced (N2). CXN-SEC-01 unconfirmed |
| ST-SAS-001 [FOUNDATION: TENANT-REGISTRY] Control-plane tenant registry and pro... | 4/5 | apps/api/test/system-tenants.test.ts; apps/api/test/provisioning/saga.test.ts; TenantListScreen.test.tsx | AC-5: no test for the seven states of SAS-02; get_resources_tenant and get_resources_tenant_id are not implemented (they duplicate listSystemTenants and getSystemTenant: change request); the infrastructure steps run behind MOCK ports (`infra:check` lists the story as waiting for temporal) |
| ST-SAS-003 [FOUNDATION: LICENSE] Issue, time-based status and revoke signed li... | 9/11 | packages/kernel/test/license.test.ts; apps/api/test/licenses.test.ts, license-reads.test.ts; packages/db/test/license-store.test.ts; LicenseDetailScreen and LicenseActionScreen tests; V012 | AC-1: the status job (Issued, Active, Grace, Expired labels, one event per transition) is not built; AC-9: no seven-states test for SAS-12 (LicenseIssueScreen); no control-plane list of licenses |

### NOT STARTED (0)

None. Every R0 story has at least one test, document or declaration in the repository.

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

## 7. Final milestone gate (M2 closed)

### 7.1 What this pass did and did not do

Read-only evidence gathering at HEAD `37b015a`. No test suite, database or browser run was made (reviews were running), so every
status rests on the repository: test titles, source, migrations, runbooks, `docs/spikes`, `TODOS.md`. Light checks that were run and passed:
`node scripts/uat-trace.mjs`, `npm run uat:check`, `node --test scripts/uat-trace.test.mjs` (24 tests, 99 percent line coverage of the script),
`npm run migrations:check`, `commands:check`, `infra:check`, `alerts:check` (9 rules), `expand-contract:check`, `i18n:check`, `lint:error-codes`.
The full verification of Task 23 step 2 (`npm test`, the browser lane) is still to be run by the lead.

Two limits of the method: (a) "covered" means a live test title carries the acceptance id. That is necessary, not sufficient: a few ids
are carried by a test that proves only part of the criterion (KERNEL-020-2 names `machvon_sync` but the test covers the application role;
KERNEL-022-3 and KERNEL-051-1 are proven for the rule and the evaluator, not for a delivered page; ADM-009-1 is proven for four eyes and
publication, not for the Keycloak synchronisation; KERNEL-031-1 for the generators, not for the visual ratio). Where the missing half
changes the verdict the story is PARTIAL or DONE_PENDING_ENV above. (b) The title of a story or of a criterion was read, not the whole
test body, for the DONE stories.

The gate itself changed: `scripts/uat-trace.mjs` used to enforce only DONE. It now enforces DONE, DONE_PENDING_ENV and DONE_UNCONFIRMED;
a DONE_PENDING_ENV story may name in `docs/story-status.json` (`externalChecks`) the ids that only an external system can prove, and the gate
refuses an external check on any other status, on an unknown id, on an id a live test now names, and with an empty description
(`scripts/uat-trace.test.mjs`, 24 tests). `docs/UAT-COVERAGE.md` lists the external checks in its own section.

### 7.2 Findings F1 to F18 now

| # | State | Evidence or what remains |
|---|---|---|
| F1 RLS completeness on the migrated database | Fixed | `packages/db/test/rls-catalog.test.ts` runs on the fully migrated database |
| F2 `system.*` in `role_definition` | Fixed | `db/migrations/V007__role_definition_system_permissions.sql`, `packages/db/test/role-definition-system-permissions.test.ts` |
| F3 upgrade test, expand-contract | Fixed | `packages/db/test/migration-upgrade.test.ts`, `scripts/expand-contract-check.mjs`; `db/migrations/expand-contract.json` exempts V003 to V019 (`baselineThrough: 19`): the release manager must freeze that number at the first production release |
| F4 signed context for consumers, alerts | Fixed in code | `consumer-inbox.test.ts`, rules `OUTBOX_CONTEXT_TAMPERED`, `OUTBOX_EVENT_DEAD` in `alerts/rules`; the alert sink is handed to the relay and the consumers by the API process (N1 fixed) |
| F5 full-page visual ratio, new baselines | Open: product owner | `docs/r10-baseline-approvals.md`: 24 screens, 0.9 to 4.3 percent against 0.1 percent; baselines unchanged; the prototype and `screen_catalog.json` are not edited until the owner answers |
| F6 browser lane in CI | Fixed in the repository, unproven | `.github/workflows/browser.yml`, `docs/runbooks/release-checklist.md`; never run on a hosted runner (Windows baselines, font risk on Ubuntu) |
| F7 acceptance ids in test titles | Fixed | 156 of 196 ids named (was 23), `scripts/uat-trace.mjs`, `docs/UAT-COVERAGE.md`; the other 40 are listed in section 1 |
| F8 scheduled jobs | Fixed | scheduler port, advisory-lock runner and CLI exist (`packages/kernel/src/scheduler.ts`, `packages/db/src/job-runner.ts`, `scripts/jobs-run.mjs`, `docs/runbooks/jobs.md`); the API process starts them (N1 fixed: `apps/api/src/workers/`, `workers-runtime.test.ts`); the first run of a job comes one interval after the start |
| F9 module boundaries | Partly fixed | `apps/api/src/modules/registry.ts` and its README exist; `.dependency-cruiser.cjs` still has package-level rules only (plus the alerts-independent-of-notifications rule), no module graph rule, no `application/public` structure. Do before the first M3 slice |
| F10 real bootstrap | Fixed | `apps/api/src/serve.ts`, `bootstrap.ts`, `config/`, `health/`, `apps/api/test/bootstrap.test.ts`, `docs/runbooks/api-runtime.md`; `build` is a type check; the relay and the jobs start with the process unless `WORKERS_ENABLED` is off (N1 fixed) |
| F11 row-level tamper localisation | Open (P3) | reports the seal window; change request logged in TODOS.md |
| F12 replay header name | Open (P3) | code sends `Idempotency-Replayed` (`apps/api/src/command.interceptor.ts`), KERNEL-028 AC-1 writes `Idempotent-Replayed`; record the decision in a change request |
| F13 OpenAPI lint breadth | Partly fixed | `packages/contracts/src/breaking-changes.ts` and `contracts:compat` (N versus N-1) and the Dart generator exist; `lint-openapi.ts` still checks only `x-permission` and secret exposure, not Idempotency-Key, If-Match and Problem on every write |
| F14 `snapshot_id`, `as_of` on list reads | Open (P3) | no `snapshot_id` in any TypeScript source |
| F15 13 versus 14 system roles | Recorded | PROGRESS.md assumption table ("14 vai trò hệ thống (plan nói 13)") |
| F16 `error.*` keys in the web catalogues | Open (P3) | `apps/web/src/i18n/en.json` holds no `error.` key |
| F17 PROGRESS.md duplicates | Open (P3), yours | the M2c line appears twice (lines 31 and 35), the header still says M2e is being pushed and the "now" counts are 11/15/31; I was told not to edit PROGRESS.md |
| F18 `machvon_sync` publication | Open, external | waits for the PowerSync deployment (KERNEL-002); DONE_PENDING_ENV on KERNEL-020 |

### 7.3 New deviations found in this pass

| # | Deviation | Spec or doc reference | Severity |
|---|---|---|---|
| N1 | **Fixed. The API process now starts its background work.** `bootstrap.ts` starts, once the server listens and unless `WORKERS_ENABLED=false`, the scheduler with the six jobs of `docs/runbooks/jobs.md` at their documented intervals (one owner per job through the advisory lock), the outbox relay with every consumer of the repository (tenant provisioning, entitlement and tenant status cache invalidation, notifications) and the one `createAlertSink` handed to the relay, the seal job, the job runner and the consumers. `stop()` clears the timers and waits for the tick in flight; a failing tick is logged by error class and raised as `JOB_FAILED`, never fatal. The wiring is `apps/api/src/workers/` and `provisioning-wiring.ts`; the end-to-end stack uses the same code. Proof: `apps/api/test/workers/workers-runtime.test.ts` (database lane: an event written by an HTTP command is relayed without a manual run; a planted audit tamper is found by the started verify job, which raises `AUDIT_CHAIN_BROKEN`; `OUTBOX_EVENT_DEAD`; shutdown waits for a tick held by a table lock; the switch), `workers.test.ts`, `outbox-consumers.test.ts`, `config.test.ts`. What remains is in TODOS.md ("Workers in the API process"): MOCK provisioning ports and mailer, no resume of a run in flight at a restart, no metrics exporter, first run one interval after the start | ADM-002 AC-1, ADM-001 TK-6, KERNEL-022, M2f plan Decisions ("Scheduling") | closed |
| N2 | Security policy is stored and versioned but not enforced or synchronised: no sync of required actions to Keycloak or "not yet applied at IdP" warning, no idle timeout or absolute session expiry, no IP allowlist check, no download TTL. ADM-14 says so on screen. The story purpose is "enforced at the identity provider" | ADM-009 AC-1, KERNEL-027 AC-3 | P2 |
| N3 | Trust anchors for signature verification are a directory (`MACHVON_TRUST_ANCHORS_DIR`), not per-tenant configuration data; `document_signature` append-only is not enforced by the database; revocation is always UNKNOWN (no OCSP or CRL adapter) | BR-DOC-15, DOC-003 | P2 |
| N4 | The OpenTelemetry SDK packages are not used: the repository has its own tracer port, so the "Telemetry" decision of the M2f plan (`@opentelemetry/api`, `sdk-trace-base`) is not what was built | KERNEL-050, K9 | P3 |
| N5 | The tool that runs the `UI-<screen>` screen-contract cases (`test_cases.json`, type `screen-contract`, status NOT_RUN) does not exist. Eighteen acceptance criteria end with "screen contract checks of UI-<screen> report 0 failures". Seven-state tests, route walk and visual regions stand in (`docs/r10-baseline-approvals.md`, `docs/runbooks/web-e2e.md`). The stories that have only this gap are kept DONE; a decision is needed whether that stands | ADM-004, ADM-005 and eleven more stories | P2, decision |
| N6 | Four operations of R0 stories are not implemented and need a change request each: `get_resources_outbox_event(_id)` (ADM.md says the outbox is not exposed), `get_resources_tenant(_id)` (duplicates `listSystemTenants`, `getSystemTenant`). Other contract questions are in TODOS.md ("M2f lane ... design gaps": `access_policy` of suspend, `acceptInvitation` plane, `guest_seats` key, `EffectiveAccess` schema, control-plane license list, `INFECTED_FILE_BLOCKED`, `LICENSE_GRACE`, `SIGNATURE_INVALID` for storage URLs, ADM-08/ADM-14 reads CR-ADM-06) | ADM-001, SAS-001, M2f plan "Design gaps" | P2 |
| N7 | The system role matrix is still pending sign-off and does not give TENANT_ADMIN and UNIT_ADMIN `membership.read`, `contract.read` or `iam.guest.invite`: only TENANT_OWNER can use ADM-02 and ADM-17 fully | ADM-006, ADM-007, IAM.md section 2 | P2, business owner |
| N8 | Seat check of a guest runs at acceptance, not at invitation; the license status job and `sas.license.expiring.v1` reminder, certificate expiry reminder and invitation expiry job are not scheduled | SAS-003, ADM-006, ADM-008 | P3 |

Contradictions fixed in this pass: none of the above is both small and safe; N1 was fixed afterwards (see its row). N2 needs a platform migration; the others are decisions. Fixed here: the gate (it ignored DONE_PENDING_ENV and DONE_UNCONFIRMED), the
`docs/runbooks/jobs.md` claim that the API process runs the jobs, the release checklist text about which statuses the gate enforces.

### 7.4 NFR coverage now (section 4 updated)

| NFR | State |
|---|---|
| TENANCY-01 API, -02 RLS, -03 cache keys, -08 signed context | covered (isolation suite with cache, search, file and export channels; `rls-catalog.test.ts`; `consumer-inbox.test.ts`) |
| TENANCY-04 search | PARTIAL: `search_document` (V018) filtered by tenant and ACL; no writer feeds it; no accent folding |
| TENANCY-05 object storage, -06 export | PARTIAL: keys, signed URLs, upload checks and `runScheduledExport` on MOCK adapters; no real store, no export job |
| TENANCY-07 PowerSync | NOT RUN (external), F18 |
| TENANCY-09 unit-tree scopes | PARTIAL: org units yes, index plan proven with `EXPLAIN`; project and contract resources do not exist |
| SECURITY-01, -04, -05, -08, -11 | covered (-11 at window granularity) |
| SECURITY-02 control plane | covered (control database role, audience, step-up, `apps/api/test/authz`) |
| SECURITY-03 MFA and session | PARTIAL: aal2 claims and the published MFA role list at tenant selection; no idle or absolute limits (N2); no sign-in or TOTP here (IAM-002) |
| SECURITY-06 secrets, -07 supply chain | PARTIAL: secret scan, references only, `npm audit` on production dependencies at `high`, SBOM from the lockfile; no KMS, no image scan, no daily schedule (KERNEL-013-3), development advisory (tinypool) |
| SECURITY-12 upload checks | covered on MOCK adapters (magic bytes, size, scan pending) |
| OPERABILITY-01 entry gate | gate and declarations exist; all 8 components PLANNED without restore evidence |
| OPERABILITY-02 gates | covered; module graph rule open (F9) |
| OPERABILITY-03 migrations | covered (`migrations:check`, `expand-contract:check`, upgrade test); N versus N-1 harness missing (KERNEL-014) |
| OPERABILITY-04 Temporal | pattern on the in-process adapter; real Temporal NOT RUN |
| OPERABILITY-05 outbox and inbox | covered in code and tests; started with the API process (N1 fixed) |
| OBSERVABILITY-01 telemetry | PARTIAL: allowlist, PII drop, propagation through the outbox correlation id; SDK not used (N4) |
| OBSERVABILITY-02 alerts | PARTIAL: 9 rules with owner and runbook, `alerts:check`; channel adapter is MOCK; the relay, the seal job and the consumers receive the sink (N1 fixed) |
| PERFORMANCE-01 | PARTIAL: scope queries p95 under 100 ms on 5,000 units and 50,000 grants; PDP under 20 ms not measured |
| PERFORMANCE-02..04 | NOT STARTED |
| RETENTION-02 legal hold, -03 suspended tenant read and export | covered (ADM-003, SAS-004) |
| AVAILABILITY-02, -03, LEGAL-01 (RPO, RTO, residency) | declarative residency check only; restore and RPO measurements NOT RUN (external) |

### 7.5 Decisions, kits and ledger now (section 5 updated)

D-B03 Vietnamese cloud: residency is a declarative check (`infra/policies/residency.json`, `infra:check`); no cloud account.
D-B07 stack: NestJS, React and Vite, PostgreSQL with RLS, outbox yes; Redis, Keycloak, Temporal, PowerSync as ports, MOCK adapters and
declarations only. D-B11: shell and tokens bound to the mockup; content deviation open (F5). D-B12 Flutter: generated ThemeData, the Dart
client and the spike code exist, no application. K1 modules: registry yes, graph rule no (F9). K5 and R9 Temporal as single owner: the
pattern is built and tested on the in-process adapter. K7 Keycloak: realm template and infra check, no instance. K9 OpenTelemetry: own port (N4).
R1 infrastructure per slice: declarations and an entry gate that currently keeps eleven R0 stories waiting until restore evidence exists.
R4 legal rules as data: not started (KERNEL-060 and -110 are R1); CXN-DOC-01 to 07, CXN-SEC-01, CXN-13, CXN-AI-01 are unconfirmed and mark
DOC-001, DOC-003 DONE_UNCONFIRMED and are named on DOC-002, DOC-004, DOC-005, ADM-009, KERNEL-004, KERNEL-011. R10 new screens drawn in the
prototype: not followed for 24 screens, packet written (F5). R11 traceability: followed at test level (F7).

### 7.6 Prioritised fix list

Decisions and actions that are yours (cannot be closed in the repository):

1. **Product owner (F5):** approve, keep or reduce to gated regions the baseline of each of the 24 screens in `docs/r10-baseline-approvals.md`.
2. **N5:** decide whether the standing-in checks are accepted for the 18 `UI-<screen>` criteria or a runner is to be built.
3. **Business owner:** confirm or waive CXN-DOC-01..07, CXN-SEC-01, CXN-13, CXN-AI-01; sign the system role matrix (N7); confirm the guest bound of BR-IAM-08.
4. **Change requests (N6, F12, F14):** the four unimplemented operations, the replay header name, `snapshot_id`/`as_of`, the other entries of TODOS.md.
5. **PROGRESS.md (F17):** replace the counts by section 1, remove the duplicate M2c line, record the DONE_PENDING_ENV and DONE_UNCONFIRMED lists (Task 23 step 5).
6. **Environment owners:** the external checks of `docs/story-status.json` and the commands in `docs/spikes/README.md` (CA sandbox, PowerSync, Vietnamese cloud, Keycloak, Temporal, device).

Fixes in the repository, in order:

1. ~~**P1 N1:** start the relay, the scheduler and the alert sink in `bootstrap.ts`~~ done: `apps/api/src/workers/`, database-lane test `workers-runtime.test.ts`. Before the first deployment still set `WORKERS_ENABLED` per process (default on) and size the database connections for the extra pools (`docs/runbooks/api-runtime.md`).
2. **P1 before M3 slices (F9):** module graph rule in `.dependency-cruiser.cjs` and `modules/<code>/application/public` structure (kit K1).
3. **P2 N2 and ADM-009, KERNEL-027:** Keycloak policy synchronisation port with a MOCK adapter and the "not yet applied" warning; session heartbeat and absolute expiry column (platform migration) so the limits are enforced.
4. **P2 PARTIAL stories that can be finished here:** DOC-002 ledger export; SAS-003 status job and SAS-12 states test; ADM-006 rank-aware actions and quota display; SAS-001 SAS-02 states test; IAM-005 PDP decision benchmark; KERNEL-013 daily audit workflow with an owner alert; KERNEL-014 N versus N-1 compatibility harness and feature flags; KERNEL-030 Dart response round trip and renamed-field test; per-tenant trust anchors (N3).
5. **P2 waits for another module:** KERNEL-025-3 (BI drill), KERNEL-026-2 and IAM-005-1 (project and contract resources), ADM-007-2 (CTR events), IAM-002 screens (with Keycloak).
6. **P3:** F11, F12, F13 lint breadth, F14, F16 `error.*` catalogue, N4 OpenTelemetry SDK, N8 reminders and jobs, first run of `browser.yml` on a hosted runner.

Before the push, the lead still has to run the full verification of Task 23 step 2 and the Codex and `/review` rounds of step 3; this pass found no
contradiction with the spec that is both small and safe to fix without them.
