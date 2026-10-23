# M2f R0 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close milestone M2 (R0 foundation): every remaining R0 story is DONE or DONE_PENDING_ENV (all in-repo acceptance criteria pass, the part that needs a real external system is a tracked blocker with a contract-tested port and a mock), and the milestone gate of the protocol (section 6) passes.

**Architecture:** Same layering as M2a to M2e. New domain code lives in `apps/api/src/modules/<module>/` (registered through `apps/api/src/modules/registry.ts`), stores in `packages/db`, pure rules in `packages/kernel`, screens in `apps/web/src/screens/<module>/`. External systems (CA, signing, malware scan, object storage, IdP admin, scheduler, telemetry exporter, infrastructure) are ports with a MOCK adapter and one contract test suite that any real adapter must pass later. Infrastructure is declarative files plus policy checks that run in Node, because Docker, Terraform, Keycloak, Temporal and Redis are not installed on this machine.

**Tech Stack:** Same as M2e. New runtime dependencies only where named in the Decisions table, pinned exactly, at least two weeks old.

**Spec:** `Design/MACHVON_Design/03_Engineering/implementation_plan.json` stories with release R0 (listed in the status table); module docs `01_Documents/05_modules/{SAS,ADM,IAM,DOC,NOT}.md`; `docs/m2-alignment-review.md` (F5 to F10); `Design/MACHVON_Design/04_Design_Assets/screens/<ID>.png` mockups (all screens named below have one); `db/migrations/BLOCKS.md`; `docs/runbooks/test-lanes.md`; `AUTONOMOUS_EXECUTION_PROTOCOL.md`.

## R0 status now (recomputed from the repository at HEAD `ca54b7b`)

Computed with scripts kept outside the repository (operationIds from `@OperationId` in `apps/api/src`, screens from `apps/web/src/routes/screens/index.ts`, tables from `V002`, migrations V001 to V009). 28 operations and 8 screens are implemented. Of the 57 R0 stories: **11 DONE, 15 PARTIAL, 31 NOT STARTED** (the review of 2026-10-23 said 7, 13, 37).

| Status | Stories |
|---|---|
| DONE (11) | KERNEL-010, KERNEL-021, KERNEL-023 (window granularity), KERNEL-028 (TK-4 waits for M3 commands), KERNEL-111, IAM-001, IAM-003, IAM-004 (transports pending), ADM-001, SAS-002, NOT-001 |
| PARTIAL (15) | KERNEL-013 (SBOM, image scan), KERNEL-020 (`machvon_sync` publication waits for the PowerSync spike), KERNEL-022 (Temporal activities wait for KERNEL-044), KERNEL-024 (storage prefixes, presigned URLs, upload checks), KERNEL-026 (cache, search, file, export, sync channels), KERNEL-027 (maker-checker and MFA replay cases), KERNEL-030 (Dart client, N versus N-1 detection), KERNEL-031 (full-screen visual ratio: F5), IAM-005 (effective-access operation, IAM-09, performance test), ADM-002 (read operations, scheduling), ADM-004 (screen contract check tool), ADM-005 (same), ADM-006 (only the membership reads exist), SAS-001 (tenant reads, real infrastructure steps behind mock ports), SAS-006 (`retryTenantProvisioning` exists; steps 6 to 11 and `assignTenantOwner` do not) |
| NOT STARTED (31) | DOC-001..005; KERNEL-001..006 (spikes), 011, 012, 014, 015, 025, 034, 040, 041, 042, 044, 050, 051; IAM-002; ADM-003, ADM-007, ADM-008, ADM-009; SAS-003, SAS-004, SAS-005 |

`ST-KERNEL-032` (UI kit) and `ST-KERNEL-090` (UAT coverage generator) are not R0; they are kits K3 and K5 of the M3 roadmap and are not planned here (Task 22 builds only the small R0 part of the UAT traceability).

## Global Constraints

- All constraints of M2a to M2e still apply (English source, Vietnamese only in i18n catalogues and test files, i18n keys `module.screen.action.state`, strict TypeScript, 90 percent patch coverage, Conventional Commits with subjects under 100 characters, pre-push gates, no `@ts-expect-error`, no sleeps for synchronisation, subagents never push, never `rm -rf`, never broad process kills).
- Migrations: platform foundation numbers V010 and up, taken from the allocation below; `npm run migrations:check` must pass; applied migrations are never edited.
- Database-backed test runs go through the shared test database of `docs/runbooks/test-lanes.md` (`npm run test:lane -- db <command>`); browser runs go through the browser lane or the lock directory `apps/web/e2e/.run-lock`; never more than one browser run and one database-backed run at a time on this machine, and at most 5 agents.
- New commands: `@Command`, generated request validation registered in `REQUEST_BODIES`, a row in `apps/api/test/authz/matrix-commands.json`, foreign-id cases in the isolation suite for id-bearing operations (`commands:check` and the isolation suite enforce these).
- New screens: the mockup `04_Design_Assets/screens/<ID>.png` is binding (D-B11); shell frame regions at ratio 0 and page frame regions at most 0.001 (documented per screen in `docs/runbooks/web-e2e.md`); the seven UI states; i18n keys in both catalogues; read-only without the write permission.
- Legal items: a story that depends on an unconfirmed legal basis (CXN ledger, `legal_confirmation_ledger.json`) is DONE_UNCONFIRMED until the business owner confirms; implement with the confirmed-at-design-time default and record it.
- Status vocabulary: DONE, DONE_PENDING_ENV (all in-repo criteria pass, a named external check is outstanding), DONE_UNCONFIRMED (legal), PARTIAL, NOT STARTED.

## Migration allocation (platform block, next free numbers)

V010 license grants and signing-key access (Task 2), V011 tenant theme grants (Task 4), V012 membership invitation grants and token index (Task 6), V013 legal hold guard (Task 10), V014 signing certificate and security policy grants (Task 11), V015 document core grants (Task 17), V016 document numbering grants (Task 17), V017 outgoing document and signing session grants (Task 19). Corrected: V010 is `member_session_self` (M2e), V011 went to Task 6 and V013, V015 and V016 to Tasks 10 and 17 as planned, so Task 2 takes the free V012. A task that needs one more takes the next free number at integration time and says so in its report; if a table needs no change the number stays free and is listed as retired in `db/migrations/blocks.json`.

## Decisions taken without asking (also written to PROGRESS.md)

| Point | Decision | Basis |
|---|---|---|
| License signing | Ed25519 through Node `crypto`; `license_signing_key` holds the key id and the public key; the private key comes from a `LicenseKeyStore` port (environment variable in development, KMS later: KERNEL-012) and never reaches the database or a log | SAS.md license rules, no KMS available |
| Deterministic PDF | `pdf-lib` (MIT) with fixed metadata and no random ids, golden SHA-256 per layout profile | DOC-001 acceptance asks for byte-identical renders; pure JavaScript, no binaries |
| PAdES parsing | `pkijs` and `asn1js` (BSD-3-Clause) for CMS verification; test signatures are produced by a test CA created in the tests (no external CA) | pure JavaScript; the real CA sandbox is a spike (Task 21) |
| Signing and number allocation by incremental update | behind `SigningPort` (`startSession`, `collect`, `cancel`) with a MOCK adapter and a contract suite | KERNEL-003 and DOC-004 need a real CA sandbox: DONE_PENDING_ENV |
| Malware scan | `ScanPort` with a MOCK adapter (EICAR test string recognised); until a scanner exists a file stays `SCAN_PENDING` and download is refused with `FILE_NOT_SCANNED` | error registry has `SCAN_PENDING` and `FILE_NOT_SCANNED` |
| Scheduling | a small `Scheduler` port: in-process timer adapter (one process owns a job through a PostgreSQL advisory lock) and a one-shot CLI `npm run jobs:run -- <job>` for an external cron; Temporal schedules replace it later (KERNEL-044) | F8 of the alignment review |
| Telemetry | `@opentelemetry/api` and `@opentelemetry/sdk-trace-base` only; exporter chosen by configuration (console or OTLP when an endpoint exists) | KERNEL-050, no collector available |
| Infrastructure | declarative YAML under `infra/` and checks in Node (`npm run infra:check`); nothing is applied to a cloud | no Docker, no Terraform |
| Spikes | each spike gets a report `docs/spikes/KERNEL-00N.md` stating what ran here and what did not; a spike whose acceptance needs an external service is DONE_PENDING_ENV | environment inventory below |
| Outbox reads | the story lists `get_resources_outbox_event` and `get_resources_outbox_event_id` but `ADM.md` states the outbox is not exposed: do not implement them; raise the change request below | ADM.md section 7 |

## Environment inventory (checked on this machine)

Available: Node 24, npm, Git, Chrome (Playwright), Flutter 3.47.7 and Dart 3.13.5, Java 17, embedded PostgreSQL 18 through npm. Not available: Docker, Terraform, Keycloak, Temporal, Redis, PowerSync, a CA sandbox, cloud accounts in a Vietnamese region, model provider keys. Owners for D03 to D10 of the spec are not named.

## External blockers (cannot be closed in the repository)

KERNEL-002 (PowerSync service), KERNEL-003 and DOC-004 (CA sandbox), KERNEL-004 (provider keys, domestic model access), KERNEL-005 and KERNEL-044 (Temporal server), KERNEL-006, 011, 040, 041 (a Vietnamese cloud account for RPO/RTO and residency evidence), KERNEL-042 and IAM-002 (Keycloak instance, the realm and `SPIKE-KEYCLOAK-ORGANIZATIONS`), KERNEL-001 (needs a device or emulator and the IdP), PO approval of new visual baselines (F5), legal confirmation of CXN-DOC-01..07, CXN-SEC-01 and CXN-13.

## Design gaps (change request entries needed; none is edited silently)

1. `get_resources_outbox_event(_id)` in ST-ADM-001 contradict `ADM.md` ("outbox_event not exposed"): remove the two operations from the story (recommended) or define an operator-only DTO.
2. The DOC-001 acceptance cites `INFECTED_FILE_BLOCKED`, which is not in `error_codes.json`; use `FILE_NOT_SCANNED` / `SCAN_PENDING` for refused files or register the new code.
3. `LICENSE_GRACE` in the SAS-003 acceptance is a license state, not an error code; the state belongs to the `LicenseMode`/status enumeration of the kernel entitlement function, not the error registry.
4. `get_resources_tenant` and `get_resources_tenant_id` (SAS-001) duplicate `listSystemTenants` and `getSystemTenant` that M2e implemented; decide whether to keep both.
5. No notification event types are registered for invitations, license expiry or signing; each task that emits one registers it through `docs/notification-event-types.md` (control-plane catalogue) and lists it.

## Review Focus

- An invitation token is single use, expires, is stored only as a hash and is compared in constant time; an accepted invitation can not be replayed by a second user or after `endMembership`.
- A suspended tenant keeps read and export working and refuses every other write with `TENANT_SUSPENDED` or `TENANT_WRITE_FROZEN` immediately (no 60 second window for the suspend itself: the entitlement cache is invalidated by the command).
- A license window that starts tomorrow, ends today, or overlaps another revision is refused with `LICENSE_RANGE_INVALID`; a license signed for tenant A presented for tenant B is `LICENSE_TENANT_MISMATCH`; a revoked license never becomes valid again.
- A theme overlay rejected by `validateTenantOverlay` never reaches storage; publish uses the reviewed draft only (`REVIEW_INVALID` for expired, used, foreign or stale reviews); rollback re-publishes an old version without editing it.
- A legal hold blocks every purge path including the retention job and the tenant export cleanup; releasing needs a second person and a reason of at least 10 characters.
- The deterministic PDF has the same bytes on two runs, on two machines, and with `TZ` and locale changed; a PDF with an incremental update is flagged by the verifier (`INCREMENTAL_CHANGES_NOT_ALLOWED`) and a signature without a proven signing time is `SIGNING_TIME_UNPROVEN`.
- A unit-tree scope check on 5,000 units and 50,000 grants uses the path index (verified with `EXPLAIN`, not a timing guess) and answers in under 100 ms p95 on the shared test server.
- The scheduler runs a job on one process only; a crashed owner releases the advisory lock and another process picks the job up; every run records start, end, outcome and raises the alert on failure.

## Slices (parallel lanes; at most 5 agents)

Lane A (tenant lifecycle): Tasks 1, 2, 3, 4, 5, 8. Lane B (members and access): Tasks 6, 7, 9. Lane C (governance and runtime): Tasks 10, 11, 12, 13, 14. Lane D (documents): Tasks 17, 18, 19. Lane E (platform quality and infrastructure): Tasks 15, 16, 20, 21, 22. Task 23 closes. Order inside a lane is the task order; lanes only meet at the dependencies in the last section.

---

### Task 1: Suspend and resume a tenant (ST-SAS-004, SAS-03)

**Files:**
- Create: `apps/api/src/modules/sas/tenant-state.controller.ts` (module registered through the registry), `packages/db/src/tenant-state.ts` (state change plus freeze), `apps/web/src/screens/sas/TenantDetailScreen.tsx` and `tenant-detail/*`, tests
- Modify: `apps/api/src/provisioning`/registry only to reuse `assertTenantTransition`, `apps/web/src/routes/screens/index.ts`, i18n keys `sas.tenantDetail.*`

**Interfaces:**
- Consumes: M2e registry (`isTenantTransition`, `assertTenantTransition`), entitlement cache invalidation (`AuthzCache.invalidateTenant`, `EntitlementCache`), `ReadOnlyModeGuard`. (Corrected after Task 1: `SessionDenyList` is not used: a token issued while the tenant was Active says `mode: FULL`, so the guard judges every tenant request by the live state `tenant_runtime` instead.)
- Produces: operations `suspendTenant` and `resumeTenant` (control plane, permission `system.tenant.manage`, versioned, reason of 10 to 2000 characters); `suspendTenant(tx, input, whileActing)` and `resumeTenant(tx, input, whileActing)` in `packages/db/src/tenant-state.ts` returning the `StateChange` (with the new version); event `sas.tenant.status_changed.v1` `{tenant_id, from, to, reason_code?}` (the name SAS.md 3.2 and the openapi `x-events` give; there is no `suspended.v1` or `resumed.v1`); audit rows `tenant.suspended` and `tenant.resumed` (openapi `x-audit-action`) on the affected tenant, with the reason, as `tenant.provisioning_retry` does; `CommandScope.afterCommit` in the command pipeline; `TENANT_RUNTIME` (live state, 1 s cache plus invalidation by the command) read by `ReadOnlyModeGuard`; `access_policy` must be the one the reason implies (only `SECURITY_INCIDENT` is `NO_ACCESS`), because `tenant_runtime` derives it from the stored reason (422 `VALIDATION_FAILED` on `access_policy` otherwise); no migration.

- [ ] **Step 1: Write failing tests**: Active to Suspended and back; any other transition is 409 `TENANT_STATE_INVALID`; during Suspended a tenant command is refused with `TENANT_SUSPENDED` while `GET` and export succeed (AC of the story); the entitlement and access caches of the tenant are invalid at the moment the command returns (test with a cache that records `invalidateTenant`); a second operator cannot resume with a stale `If-Match`; a tenant-plane token on the control command is 403 `SCOPE_DENIED`; wrong tenant id is 404; screen SAS-03: suspend and resume buttons only for `SystemAdmin`, reason field, confirm dialog, seven states, visual regions against `SAS-03.png`.
- [ ] **Step 2: Run** the new tests through the db lane; expected FAIL.
- [ ] **Step 3: Implement** the store, the two commands (registered in `REQUEST_BODIES`, `matrix-commands.json`) and the screen.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check && npm run i18n:check`, then the SAS-03 visual case under the browser lane; expected PASS.
- [ ] **Step 5: Commit** `feat(api): suspend and resume tenants with an immediate read-only mode`.

### Task 2: License issue, status and revoke, backend (ST-SAS-003, TK db/backend/security)

**Files:**
- Create: `db/migrations/V010__license_access.sql`, `packages/db/src/license-store.ts`, `packages/kernel/src/license.ts` (status function), `apps/api/src/modules/sas/license.controller.ts`, `apps/api/src/modules/sas/license-signer.ts` (`LicenseKeyStore` port, Ed25519 signer, environment adapter), tests
- Modify: `.env.example` (key variable names only), notification event type catalogue entry `sas.license.expiring.v1`

**Interfaces:**
- Produces: kernel `licenseStatusAt(revision, now): 'Scheduled' | 'Active' | 'Grace' | 'Expired' | 'Revoked'` and its mapping to the entitlement `LicenseMode`; `LicenseKeyStore { current(): Promise<{ keyId: string; sign(payload: Uint8Array): Promise<Uint8Array> }>; publicKeys(): Promise<ReadonlyMap<string, Uint8Array>> }`; `LicenseStore.issue(tx, input)`, `revoke(tx, id, reason, expectedVersion)`, `verifySignature(revision)`; operations `post_licenses`, `post_licenses_id_revoke`, `get_resources_license_revision`, `get_resources_license_revision_id` (permission `system.license.manage`, control plane); event `sas.license.changed.v1` that makes the entitlement consumer record a new version.

- [ ] **Step 1: Write failing tests**: issue with a valid window, features and tenant produces a signed revision whose signature verifies with the public key and fails after one byte of the payload changes; windows with `valid_from >= valid_until` or overlapping another non-revoked revision are 422 `LICENSE_RANGE_INVALID`; presenting the license of tenant A for tenant B is 422 `LICENSE_TENANT_MISMATCH`; status function boundary cases (exactly at `valid_until`, inside grace, after grace, revoked beats everything, scheduled before start); revoke twice is 409 `LICENSE_STATE_INVALID`; an expired license makes `allowedFeature` follow the expiry behaviour of the plan (existing kernel tests extended); the private key never appears in the table, the audit diff or logs (scan the captured log output of the test); a tenant token on the control operations is 403; control matrix rows for the two commands; replay of the issue command with the same key returns the same revision.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** the migration (grants for `machvon_control` on `license_revision` and `license_signing_key` as the store needs; revoke `UPDATE`/`DELETE` on issued revisions except the revoke columns through the store), the kernel function, the signer, the store and the controller.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check && npm run db:check && npm run migrations:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): issue, verify and revoke signed licenses`.

### Task 3: License screens SAS-12, SAS-13, SAS-15 (ST-SAS-003 web)

**Files:**
- Create: `apps/web/src/screens/sas/license/*` (`LicenseListScreen`, `LicenseIssueScreen`, `LicenseDetailScreen`), i18n keys `sas.license.*`, tests, e2e flow in `apps/web/e2e/sas-flows.spec.ts` (re-read before editing)
- Modify: `apps/web/src/routes/screens/index.ts`, `docs/runbooks/web-e2e.md`, `apps/web/e2e/visual.spec.ts`

**Interfaces:**
- Consumes: Task 2 operations and the M2d client (`ifMatchVersion` for revoke).
- Produces: SAS-12 list (status badges for the five license states, filter by tenant), SAS-13 issue form (window, features, tenant; server errors on the field), SAS-15 detail with revoke (reason, version); read-only for `PlatformOperator`.

- [ ] **Step 1: Write failing tests**: status badges distinct for the five states; issue form shows `LICENSE_RANGE_INVALID` on the window fields and keeps typed values; double submit sends one request; revoke asks for a reason of 10 or more characters; operator has no controls; the seven states; visual regions against the three PNGs.
- [ ] **Step 2: Run** `npm test -w @machvon/web -- license`; expected FAIL.
- [ ] **Step 3: Implement** the three screens with the existing kits.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run i18n:check` and the browser lane for the new flow and visual cases; expected PASS.
- [ ] **Step 5: Commit** `feat(web): add the license list, issue and detail screens`.

### Task 4: Tenant theme and branding, backend (ST-SAS-005 backend)

**Files:**
- Create: `db/migrations/V011__tenant_theme_access.sql`, `packages/db/src/theme-store.ts`, `apps/api/src/modules/sas/theme.controller.ts` (draft, review, publish, rollback, versions, published theme read, asset upload), `apps/api/src/modules/sas/theme-assets.ts` (MIME and size validation, content hash), tests

**Interfaces:**
- Consumes: `validateTenantOverlay` from `@machvon/design-tokens` (the only entry for theme validation), `ObjectStoragePort` of Task 15 when it exists (before that an in-memory adapter behind the same port).
- Produces: operations `getSystemTenantThemeDraft`, `putSystemTenantThemeDraft`, `reviewSystemTenantTheme`, `publishSystemTenantTheme`, `listSystemTenantThemeVersions`, `uploadSystemTenantThemeAsset` (multipart), `getMyPublishedTheme` (tenant plane, any member); store methods `saveDraft`, `review(draftId, reviewerId)` (reviewer differs from author: `SELF_APPROVAL_DENIED`), `publish(reviewId)` (single use review), `rollback(versionId)`; pointer `tenant_theme_pointer` moved atomically; event `sas.theme.published.v1`.

- [ ] **Step 1: Write failing tests**: draft with a 3.2:1 pair is rejected with the contrast finding and nothing is stored; 4.5:1 accepted; review by the author is refused; review bound to a draft hash: editing the draft after review makes publish fail with `REVIEW_INVALID`, a used or expired review the same, a review of another tenant the same; publish moves the pointer and bumps the version in one transaction (concurrent publishes: one wins with `VERSION_CONFLICT`); rollback re-points to an older version without creating a new row content change; `getMyPublishedTheme` returns only the published overlay of the caller's tenant (foreign-id style isolation case); asset upload refuses wrong MIME, over-size logo, SVG with scripts; control matrix rows; replay semantics.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** migration grants, store and controllers; multipart is handled by a small request parser inside the controller (the typed client excludes multipart: Task 5 adds a helper).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check && npm run db:check && npm run migrations:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): draft, review, publish and roll back tenant themes`.

### Task 5: Theme screen SAS-04 and the multipart helper (ST-SAS-005 web)

**Files:**
- Create: `apps/web/src/screens/sas/theme/*` (`ThemeScreen`, preview isolation frame, review panel), `packages/api-client/src/multipart.ts`, i18n keys `sas.theme.*`, tests, e2e flow
- Modify: `apps/web/src/routes/screens/index.ts`, `apps/web/src/theme/ThemeProvider.tsx` only to consume `getMyPublishedTheme` after sign-in (tests first), `docs/runbooks/web-e2e.md`

**Interfaces:**
- Produces: `uploadFile(client, operation, input: { path; file: Blob; field: string })` in the api-client (multipart, no JSON header, same error handling); the SAS-04 screen: draft editor limited to the overlay tokens of the design-tokens package, live preview in an isolated frame (no CSS leaks into the app), submit for review, review by another system admin, publish, rollback list; Tenant Admin sees it read-only.

- [ ] **Step 1: Write failing tests**: rejected overlay shows each finding keyed (`CONTRAST`, `FORBIDDEN_VALUE`, `BAD_COLOR`) and never applies to the preview; preview isolation (the app's own computed colours are unchanged while a draft previews); review and publish buttons obey the roles; rollback asks confirmation; multipart helper sends no `Content-Type` JSON header and surfaces Problem+JSON; after sign-in the published theme of the selected tenant is applied (existing tenant-switch test shape); seven states; visual regions against `SAS-04.png`.
- [ ] **Step 2: Run** `npm test -w @machvon/web -- theme` and `npm test -w @machvon/api-client`; expected FAIL.
- [ ] **Step 3: Implement** the helper and the screen.
- [ ] **Step 4: Run** the full web verification and the browser lane for the new cases; expected PASS.
- [ ] **Step 5: Commit** `feat(web): add the tenant theme screen with isolated preview`.

### Task 6: Members and invitations, backend (ST-ADM-006 backend)

**Files:**
- Create: `db/migrations/V011__membership_invitation_access.sql` (the function `ensure_invited_account`; the unique index on `token_hash` already exists in V002), `packages/db/src/member-store.ts`, `apps/api/src/modules/adm/members.controller.ts`, `apps/api/src/modules/adm/invitation-token.ts`, `apps/api/src/modules/adm/invitation-mailer.ts`, `apps/api/src/session/accept-invitation.{service,controller}.ts` and `invitee.guard.ts` (acceptance runs before a tenant token exists, so it lives beside the tenant selection and is an `@IdentityCommand`), tests

**Interfaces:**
- Consumes: entitlement gate (`member.invite` limit through `allowedFeature`: `QUOTA_EXCEEDED`), `RoleStore`/`checkGrant`, the invitation mail through the `InvitationMailer` port (MOCK adapter until the OMNI email channel exists; the events are the IAM.md ones: `iam.membership.invited|activated|suspended|ended.v1`, none of them registered in the notification catalogue yet), `SessionDenyList` (ending a membership revokes its sessions), `bumpScopeVersion`.
- Produces: operations `inviteMember`, `suspendMembership`, `reactivateMembership`, `endMembership`, `acceptInvitation` (and the existing reads); `InvitationToken.create(): { token: string; hash: string }` (32 random bytes base64url, SHA-256 hash stored, constant-time compare); invitation expiry 7 days; `acceptInvitation` binds the authenticated identity's email to the invited email (`INVITATION_EMAIL_MISMATCH`), expired and already used are `INVITATION_EXPIRED` (409, IAM.md 3.3), a token that names no invitation is the one 404 `RESOURCE_NOT_FOUND`; BR-IAM-07 rules (`SELF_ACTION_DENIED`, `LAST_TENANT_OWNER`), rank rule for acting on others.

- [ ] **Step 1: Write failing tests**: token is single use (a second accept is 409 `INVITATION_EXPIRED`), a token of another tenant or a guessed token never reveals whether it exists (same status and body), expiry boundary, email mismatch, quota exceeded leaves no row, suspend/reactivate/end change `scope_version` and revoke sessions of the member within the command, ending the last owner is refused, an actor cannot act on a member of equal or higher rank, no email or token appears in the audit diff or in logs; each command in the authz matrix; replay; two concurrent accepts of one token create one membership.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** migration grants and index on `token_hash`, the store, the token helper and the controller; the invitation email goes through the notification core as an event (email channel MOCK).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check && npm run db:check && npm run migrations:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): invite, accept, suspend and end memberships`.

### Task 7: Member screens ADM-02, ADM-17 and guest contractors (ST-ADM-006 web, ST-ADM-007)

**Files:**
- Create: `apps/api/src/modules/adm/guest-contractor.controller.ts` (`inviteGuestContractor`), `apps/web/src/screens/adm/MembersScreen.tsx`, `apps/web/src/screens/adm/GuestContractorsScreen.tsx` and subfolders, i18n keys `adm.members.*`, `adm.guests.*`, tests, e2e flow

**Interfaces:**
- Consumes: Task 6, Task 9 (`getMyEffectiveAccess`: the guest scope rule uses unit-tree scopes), `GUEST_SCOPE_INVALID`, `CONTRACT_NOT_ACTIVE` (BR-IAM-08), contractor and contract tables (read what exists: the CTR module is R1, so use the minimal read the grant code already uses in `role-store`).
- Produces: ADM-02 member list with invite, suspend, reactivate, end (reason, versions, step-up where the contract says `x-step-up`), ADM-17 guest invitation with contract picker limited to the caller's reach.

- [ ] **Step 1: Write failing tests**: guest invite only with contract scope inside the caller's reach and a `contractor_id` match; `valid_until` required and bounded (BR-IAM-08: 365 days after the latest contract end, the design's assumption is recorded in the response error keys); screens: unit admin sees only own subtree members; read-only users have no controls; invitation shows the one-time acceptance link only in the dev session; seven states; visual regions against `ADM-02.png` and `ADM-17.png`.
- [ ] **Step 2: Run** the backend and web tests; expected FAIL.
- [ ] **Step 3: Implement** the controller and screens.
- [ ] **Step 4: Run** the full verification and the browser lane flow (invite, accept through the OIDC test provider, appear in list); expected PASS.
- [ ] **Step 5: Commit** `feat(web): add the member and guest contractor screens`.

### Task 8: Complete the provisioning saga, steps 6 to 11 (ST-SAS-006, SAS-22)

**Files:**
- Create: `apps/api/src/modules/sas/provisioning-steps-6-11.ts` (steps behind the existing saga), `apps/api/src/modules/sas/tenant-owner.controller.ts` (`assignTenantOwner`), `apps/web/src/screens/sas/ProvisioningRunScreen.tsx`, i18n keys `sas.provisioning.*`, tests
- Modify: `apps/api/src/provisioning/provisioning-saga.ts` (extend the step list; M2e left the run at `ENTITLEMENT_V1`), `packages/db/src/tenant-registry.ts` only through its existing methods

**Interfaces:**
- Consumes: Tasks 2, 4, 6 and the M2e saga, `EntitlementStore.record`, `seedSystemRoles`, `createUnit`, theme version 1 (`saveDraft` + system publish), invitation store for the owner invite.
- Produces: steps `ENTITLEMENT_V1`, `LICENSE_TRIAL`, `ROLES_SEED`, `ROOT_UNIT`, `THEME_V1`, `OWNER_INVITE` (names fixed by the plan note of M2e Task 5: read it), each idempotent with retry and compensation in reverse order; the tenant moves `Provisioning` to `Active` only after the last step; `assignTenantOwner` (control plane, `TENANT_OWNER` only from the control plane, BR-IAM-05) sends or re-sends the owner invitation; SAS-22 shows the run timeline with the failed step and retry.

- [ ] **Step 1: Write failing tests**: a full run ends Active with entitlement version 1, a trial license, 14 system roles, one root unit, theme v1 and one pending owner invitation, every step recorded; killing the saga between any two steps and resuming produces no duplicates (run the kill at each step boundary); a failing step 9 compensates 8..6 in reverse and ends `Failed` with the tenant archived path available; retry resumes from the failed step; a second `assignTenantOwner` revokes the first pending owner invitation; a tenant token cannot call it; screen states and visual regions against `SAS-22.png`.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** the steps with the ports of M2e for external systems.
- [ ] **Step 4: Run** the full verification and the browser lane flow (create tenant, watch it become Active, owner invitation visible); expected PASS.
- [ ] **Step 5: Commit** `feat(api): complete the tenant provisioning saga and owner assignment`.

### Task 9: My effective access and unit-tree scope performance (ST-IAM-005, IAM-09)

**Files:**
- Create: `apps/api/src/modules/iam/effective-access.controller.ts`, `packages/db/test/support/scope-load.ts` (seed 5,000 units and 50,000 grants), `packages/db/test/scope-performance.test.ts`, `apps/web/src/screens/iam/EffectiveAccessScreen.tsx`, i18n keys `iam.effectiveAccess.*`, tests
- Modify: `packages/db/src/scope-version.ts` only if `EXPLAIN` shows a missing index (then a migration from the platform block takes the next free number)

**Interfaces:**
- Produces: operation `getMyEffectiveAccess` (permission `session.self`): the caller's grants, resolved scopes (unit names and paths from `organization_unit`, project and contract ids), permission list with the source role, `scope_version`, `mode`; IAM-09 screen with filters by permission and scope; the performance test asserts the plan uses the `path` index (`EXPLAIN (FORMAT JSON)` contains an Index Scan on the path index, no Seq Scan on `organization_unit`) and p95 under 100 ms over 200 calls.

- [ ] **Step 1: Write failing tests**: the operation returns exactly the effective permissions the PDP computes (property: for random grants the screen data equals `effectivePermissions`), never another member's data (isolation case), shows expired and future grants separately; performance test as described; screen states, visual regions against `IAM-09.png`.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** the controller, the load fixture and the screen.
- [ ] **Step 4: Run** the full verification; expected PASS.
- [ ] **Step 5: Commit** `feat(api): show my effective access and prove the scope queries use the index`.

### Task 10: Legal hold and the purge guard (ST-ADM-003)

**Files:**
- Create: `db/migrations/V013__legal_hold_guard.sql`, `packages/db/src/legal-hold-store.ts`, `packages/db/src/purge-guard.ts`, `apps/api/src/modules/adm/legal-hold.controller.ts`, tests

**Interfaces:**
- Produces: operations `placeLegalHold`, `releaseLegalHold`, `get_resources_legal_hold`, `get_resources_legal_hold_id` (permission `legal_hold.manage` for writes; the `authority_reference` is masked in reads for callers without it); `assertNotOnHold(tx, resource: { type: string; id: string }): Promise<void>` throwing `LEGAL_HOLD_ACTIVE` (409) used by every purge path; a trigger in the migration refuses `DELETE` of any row whose resource has an active hold for the tables the retention policy purges (list them from `ADM.md` section on retention); release needs a second person and a reason (CHECK constraints already in V002: four-eyes, release reason length).

- [ ] **Step 1: Write failing tests**: placing a hold on a resource blocks `assertNotOnHold` and the trigger; release by the same person that placed it is refused (database CHECK and API); release with a short reason is refused; after release the purge works; reads mask `authority_reference`; a hold on tenant A has no effect on tenant B; matrix rows; audit rows for place and release.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** migration, store, guard and controller.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check && npm run db:check && npm run migrations:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): place and release legal holds and guard purges`.

### Task 11: Signing certificate registry and security policy versions (ST-ADM-008, ST-ADM-009)

**Files:**
- Create: `db/migrations/V014__certificate_and_policy_access.sql`, `packages/db/src/certificate-store.ts`, `packages/db/src/security-policy-store.ts`, `apps/api/src/modules/adm/certificates.controller.ts`, `apps/api/src/modules/adm/security-policy.controller.ts`, `apps/web/src/screens/adm/CertificatesScreen.tsx` (ADM-08), `apps/web/src/screens/adm/SecurityPolicyScreen.tsx` (ADM-14), i18n keys `adm.certificates.*`, `adm.securityPolicy.*`, tests

**Interfaces:**
- Consumes: `pkijs`/`asn1js` for certificate parsing (public certificates only: a private key in the upload is refused), `selectTenantContext` MFA role list (`DEFAULT_MFA_REQUIRED_ROLES`) and session limits.
- Produces: `registerSigningCertificate` (parse X.509, check validity window, fingerprint unique per tenant: `CERTIFICATE_DUPLICATE`, `CERTIFICATE_INVALID`, `CERTIFICATE_EXPIRED`), `revokeSigningCertificate`; `createSecurityPolicyVersion` and `publishSecurityPolicy` (draft by one admin, publish by another: `SELF_APPROVAL_DENIED`; published version is immutable; the active version feeds `checkAssurance` and the session limits: `loadSelectionFacts` reads the active policy, defaults when none); statuses DONE_UNCONFIRMED for the MFA role list (CXN-SEC-01).

- [ ] **Step 1: Write failing tests**: PEM with a private key block refused without echoing it; expired and not-yet-valid certificates; duplicate fingerprint; revoke is final; publish by the author refused; published policy changes which roles need aal2 at the next `selectTenantContext` (end-to-end test through the session service) and cannot be edited; a draft never affects sessions; screens: states and visual regions against `ADM-08.png` and `ADM-14.png`; matrix rows.
- [ ] **Step 2: Run** through the db lane and the web tests; expected FAIL.
- [ ] **Step 3: Implement** stores, controllers and screens.
- [ ] **Step 4: Run** the full verification and the browser lane for the visual cases; expected PASS.
- [ ] **Step 5: Commit** `feat(api): register signing certificates and publish security policies`.

### Task 12: Audit reads, the scheduler and the job runner (ST-ADM-002 and ST-ADM-001 follow-ups, F8)

**Files:**
- Create: `packages/kernel/src/scheduler.ts` (`Scheduler` port, job definition, run record), `packages/db/src/job-runner.ts` (advisory-lock ownership, run history in memory plus the metrics sink), `apps/api/src/modules/adm/audit-events.controller.ts` (`get_resources_audit_event`, `get_resources_audit_event_id`), `scripts/jobs-run.mjs`, `docs/runbooks/jobs.md`, tests
- Modify: root `package.json` (script `jobs:run`)

**Interfaces:**
- Produces: jobs `audit-seal` (every 5 minutes), `audit-verify` (hourly), `outbox-relay`, `idempotency-purge` (hourly), `access-cache-expiry`; `Scheduler.register(job)`, `start()`, `stop()`; `JobRunner.runOnce(name)` takes `pg_try_advisory_lock(hash(name))`, runs, records `{ startedAt, endedAt, outcome }`, raises the `JOB_FAILED` alert through `AlertSink` on failure and the `AUDIT_CHAIN_BROKEN` alert from the verify job; audit read DTO with `safe_diff` redacted and `impersonator_id` hidden without `audit.read`; reads respect scope (`scopePredicate`).

- [ ] **Step 1: Write failing tests**: two runners racing for one job: exactly one runs; a runner that dies releases the lock (terminate its backend) and the other runs next; a failing job raises one alert and the next run still happens; the verify job detects a tampered row planted by the owner role and raises the alert within one run (end-to-end of AC-ST-ADM-002-1); audit reads never return `safe_diff` raw values for sensitive keys and return 404 for another tenant's id; the CLI runs one job once and exits non-zero on failure; timer adapter uses an injected clock (no real sleeps).
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** the port, runner, CLI and controller.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): schedule the audit, outbox and purge jobs and add audit reads`.

### Task 13: Real API bootstrap and telemetry (F10, ST-KERNEL-050)

**Files:**
- Create: `apps/api/src/main.ts` (replace the placeholder), `apps/api/src/config/*` (validated environment: database URLs per role, OIDC issuer and audiences, signing keys, OTLP endpoint optional), `apps/api/src/health/*` (`/health/live`, `/health/ready` with database and migration checks), `packages/kernel/src/telemetry.ts` (span attribute allowlist, PII processor, trace context helpers), `apps/api/src/telemetry/*`, tests, `docs/runbooks/api-runtime.md`
- Modify: `.env.example`, `apps/api/package.json` (`start`, `build`), module registry wiring

**Interfaces:**
- Produces: `loadConfig(env): Config` throwing one error that lists every missing or malformed variable (no secret values in messages); `bootstrap(config): Promise<INestApplication>` wiring `AppModule` with real guards (`AuthModule`, `PolicyModule`, `SessionModule`, `CommandModule`) and graceful shutdown (stops accepting, drains, closes pools); `SpanAttributeProcessor` that keeps only allowlisted attributes (`tenant_id`, `operation_id`, `request_id`, `correlation_id`, `http.status_code`, `db.operation`) and drops everything else including values that look like email, phone or token; trace context carried in the outbox event (`traceparent` in the delivery) and restored in the consumer.

- [ ] **Step 1: Write failing tests**: missing and malformed configuration lists all problems at once and never prints a secret; `ready` is 503 when the database is unreachable or a migration is pending, `live` stays 200; a request produces a span with `tenant_id` and the same trace id appears in the outbox consumer span; the PII processor removes an email set as an attribute and a bearer token in a URL; graceful shutdown finishes an in-flight request and refuses a new one; the application started by `bootstrap` serves the ADM-01 reads with a test token (smoke through the real guards).
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** config, bootstrap, health and telemetry.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run build -w @machvon/api`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): bootstrap the API with validated config, health checks and telemetry`.

### Task 14: Alert framework (ST-KERNEL-051)

**Files:**
- Create: `packages/kernel/src/alerts.ts` (rule model, registry, evaluation over `MetricsSink` snapshots), `apps/api/src/alerts/*` (adapters: log, webhook port with MOCK), `alerts/rules/*.json` (one rule per file), `scripts/alerts-check.mjs` (+ test), `docs/runbooks/alerts/*.md` (one runbook per rule)
- Modify: root `package.json` (`alerts:check` in `lint`)

**Interfaces:**
- Produces: `AlertRule { id; metric; condition; severity; owner; runbook: string; channel: 'operations' | 'product' }`; `AlertEvaluator.evaluate(snapshot): FiredAlert[]`; `AlertSink` adapters; the mandatory rule set: `OUTBOX_LAG` (300 s), `OUTBOX_EVENT_DEAD`, `OUTBOX_CONTEXT_TAMPERED`, `AUDIT_CHAIN_BROKEN`, `JOB_FAILED`, `ACCESS_REVOCATION_LAG` (p95 above 60 s), `AUTHZ_DENY_SPIKE`, `PROVISIONING_FAILED`, `LICENSE_EXPIRING`; `alerts:check` fails a rule without an owner, a missing runbook file, a duplicate id, a rule not tied to an existing metric name emitted in code, or an operations-channel rule routed through the notification module (the operations channel must be independent of NOT).

- [ ] **Step 1: Write failing tests**: each mandatory rule exists with owner and runbook; evaluator fires at the boundary (299 s versus 301 s) and resolves; `alerts:check` fails on each of the five defects (scratch trees); the operations channel adapter has no import path to the notification module (architecture rule added to `.dependency-cruiser.cjs`); sink adapters of M2b to M2e (relay, seal job, consumer) are wired through one `createAlertSink(config)`.
- [ ] **Step 2: Run** `npm test -w @machvon/kernel`, `node --test scripts/alerts-check.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** rules, evaluator, adapters and the check.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture`; expected PASS.
- [ ] **Step 5: Commit** `feat(kernel): add the alert rule framework with owners and runbooks`.

### Task 15: Tenant-scoped storage, search and export; isolation channels (ST-KERNEL-024, 025, 026)

**Files:**
- Create: `packages/kernel/src/object-storage.ts` (`ObjectStoragePort`, key builder, presigned URL signer, upload validator), `apps/api/src/modules/files/*` (MOCK adapter on the file system under a temp directory for tests, `ScanPort` MOCK), `packages/db/src/search-projection.ts` (tsvector projection filtered by tenant and ACL), `apps/api/src/modules/search/*` (`searchGlobal` read with scope predicate, check the operationId in openapi), scheduled export re-authorisation helper, isolation channels `apps/api/test/isolation/channels/{cache,search,file,export}.ts`, tests

**Interfaces:**
- Produces: `objectKey(tenantId, kind, id)` always prefixed `t/<tenant>/`; `signUrl(key, ttlSeconds <= 300, now)` and `verifyUrl` (HMAC, constant-time, binds method and key); `validateUpload({ declaredType, bytes })` checks magic bytes and the allow-list, refuses mismatches with `FILE_TYPE_NOT_ALLOWED`; downloads of unscanned files are refused with `SCAN_PENDING`/`FILE_NOT_SCANNED`; search results filter by tenant (RLS) and by ACL before ranking; a scheduled export re-checks the creator's current permission at run time and fails closed.

- [ ] **Step 1: Write failing tests**: a key built for tenant A can never resolve under tenant B (property over random ids and traversal strings `..`, encoded slashes); URL expiry boundary, tampered key, replay after expiry; upload with a PNG header declared as PDF refused; the isolation suite gets four new channels and each fails when a deliberately leaky implementation is plugged in (negative controls); search never returns a document the caller's scope excludes even when the text matches; an export scheduled by a user who lost the permission fails without producing a file.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** ports, adapters, projection and channels.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): scope object storage, search and exports to the tenant and prove it`.

### Task 16: Contract leftovers, negative matrix, supply chain and the test data platform (ST-KERNEL-027, 030, 013, 034)

**Files:**
- Create: `packages/contracts/src/breaking-changes.ts` (+ CLI `contracts:compat`), `packages/mobile-api-client/*` (Dart client generated from `OPERATIONS` and the schemas by a Node generator, Dart tests), `apps/api/test/authz/maker-checker.ts` (cases), `scripts/sbom.mjs` and `scripts/supply-chain-check.mjs` (+ tests), `docs/runbooks/supply-chain.md`
- Modify: root `package.json` (scripts), `.github/workflows/ci.yml` (SBOM artifact, audit), `apps/api/test/authz/negative-matrix.ts`

**Interfaces:**
- Produces: `breakingChanges(previous, current): Change[]` flagging removed operations, removed or retyped fields, tightened enums, new required request fields and changed `x-permission`, with `contracts:compat` comparing the working tree to `git show origin/main:<openapi path>` (skipped with a clear message when the ref is missing); a Dart client with typed requests, `Idempotency-Key` and `If-Match` handling and Problem+JSON errors, generated deterministically and byte-checked by `contracts:check`; matrix cases for maker-checker (`SELF_APPROVAL_DENIED` where a command has an approver) and MFA replay (aal2 older than 15 minutes); the test data platform (KERNEL-034): `loadFixtures(db, names)` loading `test_fixtures.json` tenants into a database of the shared test server, `syntheticTenant(seed)` generating a deterministic fixture set (same seed, same rows) and `maskRow(table, row)` replacing personal fields by stable pseudonyms (email, phone, names, identity numbers: the field list comes from the data dictionary classification PERSONAL) so a staging refresh never carries real personal data; `sbom` writes a CycloneDX JSON from the lockfile through `npm sbom`; `supply-chain-check` fails on an unpinned dependency range in a workspace, a lockfile out of sync, a missing SBOM and (when a Dockerfile exists) an unscanned image policy.

- [ ] **Step 1: Write failing tests**: each breaking-change kind is detected on a doctored copy and an additive change is not; Dart client round trip tests with a fake HTTP client (`dart test`) for one versioned and one unversioned command and an error; maker-checker and MFA-replay cases run for the commands that have them; SBOM file validates against the CycloneDX shape used (components with purl and hashes); the check fails on `^` ranges in a scratch workspace; the generator is deterministic and the same seed gives the same rows; masking is stable (same input, same pseudonym), irreversible, and no PERSONAL column of the data dictionary is left unmasked (test over the dictionary).
- [ ] **Step 2: Run** the new tests; expected FAIL.
- [ ] **Step 3: Implement** the four pieces.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run contracts:check` and `dart test` for the Dart package; expected PASS.
- [ ] **Step 5: Commit** `feat(contracts): detect breaking changes, generate the Dart client and publish the SBOM`.

### Task 17: Documents: anchor, versions, deterministic PDF, number registers (ST-DOC-001, ST-DOC-002; DOC-10, DOC-21)

**Files:**
- Create: `db/migrations/V015__document_core_access.sql`, `db/migrations/V016__document_numbering_access.sql`, `packages/db/src/document-store.ts`, `packages/db/src/number-register-store.ts`, `packages/kernel/src/pdf-render.ts` (render port and layout profile contract), `apps/api/src/modules/doc/{documents,registers}.controller.ts`, `apps/api/src/modules/doc/pdf-renderer.ts` (`pdf-lib` adapter), `apps/web/src/screens/doc/{DocumentTypesScreen,NumberRegistersScreen}.tsx`, i18n keys `doc.types.*`, `doc.registers.*`, tests

**Interfaces:**
- Produces: `PdfRenderer.render(profile, content): Promise<Uint8Array>` deterministic (fixed document id, creation date taken from the content, no producer timestamp); operations `renderDocumentPreview`, `getDocumentVersionDownload`, the version reads, `defineDocumentType`, `openDocumentNumberRegister`, `closeDocumentNumberRegister`, `listDocumentNumberRegisters`, `listDocumentRegisterEntries`; register allocation is gap-free per register and year under a row lock (`REGISTER_YEAR_MISMATCH` for a wrong year, concurrent allocation never duplicates a number); downloads refuse files whose scan is pending.

- [ ] **Step 1: Write failing tests**: two renders of the same input are byte-identical, also under a different `TZ` and locale (spawn with env changed); golden SHA-256 for the layout profile `ND30_A4_STANDARD` (profile name from the story acceptance); concurrent allocation of 50 numbers from 10 workers yields 1..50 without gaps or duplicates; closing a register stops allocation; a version row is immutable (trigger); download of a pending-scan file is refused; foreign-id cases for the document reads; screens: states and visual regions against `DOC-10.png` and `DOC-21.png`; CXN-DOC-01..04 items marked DONE_UNCONFIRMED in the report.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** migrations, stores, renderer, controllers and screens.
- [ ] **Step 4: Run** the full verification and the browser lane for the visual cases; expected PASS.
- [ ] **Step 5: Commit** `feat(api): store document versions, render deterministic PDFs and allocate numbers`.

### Task 18: Signature verification and the signing port (ST-DOC-003, ST-DOC-004; DOC-07)

**Files:**
- Create: `packages/kernel/src/pades.ts` (verification result model), `apps/api/src/modules/doc/pades-verifier.ts` (`pkijs` adapter), `apps/api/src/modules/doc/signing-port.ts` (`SigningPort`, MOCK adapter, contract suite `signing-port.contract.ts`), `apps/api/src/modules/doc/signatures.controller.ts`, `packages/db/src/signature-store.ts`, `apps/web/src/screens/doc/SignatureReportScreen.tsx`, `docs/spikes/DOC-SPK-01.md`, i18n keys `doc.signatureReport.*`, tests

**Interfaces:**
- Produces: `verifyPdfSignatures(pdf: Uint8Array, trust: TrustStore, now): SignatureReport` (per signature: byte range coverage, digest match, certificate chain, validity at signing time, `DIGEST_MISMATCH`, `INCREMENTAL_CHANGES_NOT_ALLOWED`, `SIGNING_TIME_UNPROVEN`); operations `verifyDocumentSignatures` and `getDocumentSignatureReport`; `SigningPort { startSession(request): Promise<SessionRef>; collect(ref): Promise<SignedPayload | 'PENDING'>; cancel(ref) }`; the contract suite exercised by the MOCK adapter now and by a real CA adapter later.

- [ ] **Step 1: Write failing tests** with a test CA created in the tests: a PDF signed once verifies; one byte changed in the signed range gives `DIGEST_MISMATCH`; an appended revision gives `INCREMENTAL_CHANGES_NOT_ALLOWED` unless it is the allowed numbering revision (rule from the story acceptance: read it); an untrusted chain, an expired certificate at signing time and a missing timestamp are keyed findings; the report never contains private material; `SigningPort` contract suite passes for the MOCK adapter and fails for a deliberately wrong one (negative control); screen DOC-07 states and visual regions against `DOC-07.png`.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** the verifier, port, MOCK adapter, controller, store and screen; write the spike report marking the real CA round trip as not run (no CA sandbox).
- [ ] **Step 4: Run** the full verification and the browser lane visual case; expected PASS (DOC-004 and KERNEL-003: DONE_PENDING_ENV).
- [ ] **Step 5: Commit** `feat(api): verify PDF signatures and define the signing port`.

### Task 19: Outgoing documents with leader signing and organisation seal (ST-DOC-005; DOC-05, DOC-06)

**Files:**
- Create: `db/migrations/V017__outgoing_document_access.sql`, `packages/db/src/outgoing-document-store.ts`, `apps/api/src/modules/doc/outgoing.controller.ts`, `apps/api/src/modules/doc/numbering-revision.ts` (incremental update that adds the number without touching the signed bytes), `apps/web/src/screens/doc/{OutgoingDocumentScreen,SigningSessionScreen}.tsx`, i18n keys `doc.outgoing.*`, `doc.signing.*`, tests, e2e flow

**Interfaces:**
- Consumes: Tasks 17 and 18, the state machine of the story (`LEADER_SIGNED`, `NUMBERED`, `ORG_SEALED` states are document states, not error codes), `SELF_APPROVAL_DENIED`, `SIGNING_SESSION_EXPIRED`, `SIGNING_SESSION_OPEN`, `DOCUMENT_STATE_INVALID`, the Orchestrator port pattern of Task 20 for the multi-step flow.
- Produces: operations `startLeaderSigning`, `completeSigningSession`, `assignOutgoingDocumentNumber`, `startOrganizationSeal`; numbering by incremental update keeps the revision-0 prefix bytes unchanged (test compares the prefix hash); a failed provider call leaves the document in its previous state and returns `PROVIDER_UNAVAILABLE` so the retry is safe.

- [ ] **Step 1: Write failing tests**: the whole flow with the MOCK signer ends sealed with three valid signatures per the verifier; the prefix bytes of revision 0 never change; a second session while one is open is `SIGNING_SESSION_OPEN`; an expired session cannot complete; the drafter cannot sign their own document as leader; a provider failure mid-way keeps the state and a retry succeeds exactly once (idempotency key); state transitions outside the table give `DOCUMENT_STATE_INVALID`; screens DOC-05 and DOC-06 states and visual regions against the PNGs.
- [ ] **Step 2: Run** through the db lane; expected FAIL.
- [ ] **Step 3: Implement** store, controller, numbering revision and screens.
- [ ] **Step 4: Run** the full verification and the browser lane flow; expected PASS (DONE_PENDING_ENV for the real CA).
- [ ] **Step 5: Commit** `feat(api): sign, number and seal outgoing documents behind the signing port`.

### Task 20: Declarative infrastructure, entry gate and the orchestrator pattern (KERNEL-011, 012, 014, 015, 040, 041, 042, 044)

**Files:**
- Create: `infra/environments/{dev,staging,production}.yaml`, `infra/components/*.yaml` (postgres, object-storage, redis, keycloak, temporal, observability: each with `runbook`, `restoreTest`, `alerts`, `region`), `infra/policies/residency.json`, `infra/secrets/references.yaml` (references only), `infra/pipelines/*.yaml`, `scripts/infra-check.mjs` (+ tests), `scripts/expand-contract-check.mjs` (+ tests), `docs/runbooks/infra/*.md`, `infra/keycloak/realm-template.json`, `infra/postgres/{postgresql.conf.tpl,backup.yaml}`, `packages/kernel/src/orchestrator.ts` (`OrchestratorPort`, domain transition guard) and `apps/api/src/modules/orchestration/*` (in-process adapter), tests
- Modify: root `package.json` (`infra:check` in `lint`), `.github/workflows/*.yml` (staging deploy on main with environment protection; production by manual approval, canary cohort variable)

**Interfaces:**
- Produces: `infra:check` validates (a) every resource region is in the allowed Vietnamese list of `residency.json` and a second site exists for backups, (b) no component without runbook, restore test and alert (the entry gate of KERNEL-015: the gate fails when any of the three is missing and passes when all exist), (c) secrets are referenced (`secret://name`), never inline, with a rotation period, (d) pipeline files have an approval step before production and a canary cohort list; `expand-contract-check` fails a migration that drops or renames a column or changes its type without the `-- contract:` marker and a preceding expand migration; `OrchestratorPort.start(workflow, input, signedContext)` and a transition guard that rejects a domain-invalid signal with 403 `SCOPE_DENIED` while the workflow keeps waiting; a context whose tenant was modified is rejected with `TENANT_CONTEXT_INVALID` and zero rows are written (the acceptance of KERNEL-005 and KERNEL-044, tested on the in-process adapter; the real Temporal adapter is DONE_PENDING_ENV).

- [ ] **Step 1: Write failing tests** on scratch trees for each defect above and a pass case on the real `infra/`; the orchestrator contract suite (start, signal, guard rejection keeps waiting, tampered context rejected, version pinning: an old instance keeps following its old definition when a new definition is registered); the expand-contract check on the committed migrations passes (V001 to the latest).
- [ ] **Step 2: Run** `node --test scripts/infra-check.test.mjs scripts/expand-contract-check.test.mjs` and the kernel/api tests; expected FAIL.
- [ ] **Step 3: Implement** the files, checks and the orchestrator.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture`; expected PASS (KERNEL-011, 012, 040, 041, 042: DONE_PENDING_ENV: files and checks exist, applying them needs the cloud).
- [ ] **Step 5: Commit** `feat(infra): add declarative environments with residency, secrets and entry-gate checks`.

### Task 21: Spike reports (KERNEL-001 to KERNEL-006)

**Files:**
- Create: `docs/spikes/KERNEL-001.md` .. `KERNEL-006.md`, `docs/spikes/README.md` (status table), small runnable experiments where the environment allows: `packages/mobile-tokens/spike/` (KERNEL-001: Flutter PKCE flow against the test OIDC provider, offline queue with `UNKNOWN` then `ACCEPTED`, resumable chunked upload with SHA-256 against an upload endpoint added to the e2e stack), `scripts/ai-eval/` (KERNEL-004: evaluation harness over a MOCK model route, the publish refusal `EVAL_MISSING_FOR_ROUTE` check if the error exists in `error_codes.json`: verify before use), tests

**Interfaces:**
- Produces: for each spike a report with sections Question, Method, What ran here, Evidence, What did not run and why, Decision; statuses: KERNEL-001 DONE_PENDING_ENV (the Dart parts and the server parts run here; device Keychain/Keystore storage needs a device), KERNEL-002 NOT RUN (PowerSync), KERNEL-003 see Task 18, KERNEL-004 harness DONE and real quality NOT RUN (no provider keys), KERNEL-005 covered in Task 20 on the in-process adapter, real Temporal NOT RUN, KERNEL-006 NOT RUN (cloud); the table lists the owner and the exact command to run each unrun part when the environment exists.

- [ ] **Step 1: Write failing tests** for the runnable experiments (Dart offline queue replays one command exactly once; resumable upload does not resend chunks 1 to 6 and the final hash equals the source; the evaluation harness records per-route score, p95 latency and cost fields with the MOCK route).
- [ ] **Step 2: Run** `dart test` / `npm test`; expected FAIL.
- [ ] **Step 3: Implement** the experiments and write the six reports honestly (no invented measurements: an unrun item says so).
- [ ] **Step 4: Run** the experiments' tests and `npm run lint`; expected PASS.
- [ ] **Step 5: Commit** `docs(spikes): record what the six R0 spikes proved and what still needs an environment`.

### Task 22: Process items F5, F6, F7

**Files:**
- Create: `scripts/uat-trace.mjs` (+ test; the R0 part of kit K5), `docs/UAT-COVERAGE.md` (generated), `docs/r10-baseline-approvals.md`, `.github/workflows/browser.yml`, `docs/runbooks/release-checklist.md`
- Modify: test titles in `apps/api/test`, `packages/*/test`, `apps/web/src` of the DONE stories to carry the acceptance ids (a one-time scripted rename that keeps behaviour), `Design/MACHVON_Design/02_Prototype/*` and `03_Engineering/screen_catalog.json` for the real fields of the screens built in M2d to M2f through the R10 process (edit in place, change request entry, `design-check` stays green)

**Interfaces:**
- Produces: `uat-trace` reads all R0 acceptance ids from `implementation_plan.json` and searches test titles; writes `docs/UAT-COVERAGE.md` with columns `ID | story | test | result` and exits 1 when a DONE story has an acceptance id without a test title (the number of covered ids rises from 23 of 196); `browser.yml` runs the route walk, flows and visual regions on a Linux runner with Chrome (one job, one worker pool, the lock semantics replaced by the job concurrency group), uploads `report.json` and the diff images; `r10-baseline-approvals.md` lists every screen whose real UI differs from the mockup (ADM-01, ADM-03, IAM-04, NOT-01, NOT-02, SAS-01, SAS-02, SAS-25 and those built in this plan), the regions that are gated, the informational full-page ratios and the exact decision needed from the product owner; the baseline stays unchanged until the owner approves.

- [ ] **Step 1: Write failing tests**: `uat-trace` on a scratch tree (missing id, duplicate id, id in a skipped test is not coverage); the generated document is byte-identical on a rerun; the workflow file validates with `actionlint`-style structure checks in a Node test (jobs, concurrency group, artifact paths).
- [ ] **Step 2: Run** `node --test scripts/uat-trace.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** the script, rename test titles with a scripted pass reviewed by `git diff --stat` (names only), write the workflow and the documents.
- [ ] **Step 4: Run** `npm test && npm run lint && node scripts/uat-trace.mjs`; expected PASS and the coverage numbers printed.
- [ ] **Step 5: Commit** `chore(repo): trace acceptance ids to tests, add the browser CI lane and the baseline approval packet`.

### Task 23: Close M2 (milestone gate)

**Files:**
- Modify: `PROGRESS.md`, `TODOS.md`, `docs/m2-alignment-review.md` (final section), `Design/MACHVON_Design/03_Engineering/implementation_readiness.json` only if the counts it holds change

- [ ] **Step 1: Recompute** the R0 status table with the scripts of this plan's header and replace the table in `docs/m2-alignment-review.md`; every story is DONE, DONE_PENDING_ENV or DONE_UNCONFIRMED with the blocker listed, or the story is in the fix list.
- [ ] **Step 2: Run** the full verification: `npm test && npm run lint && npm run typecheck && npm run architecture && npm run commands:check && npm run contracts:check && npm run contracts:compat && npm run db:check && npm run migrations:check && npm run tokens:check && npm run i18n:check && npm run alerts:check && npm run infra:check && npm run routes:check -w @machvon/web && (cd ci && npm test)`, then the browser lane (`npm run e2e -w @machvon/web`) and `node scripts/uat-trace.mjs`; expected all PASS.
- [ ] **Step 3: Review** each task's commits with Codex (`codex review --commit <sha>`, at most three in parallel, in the background) and with `/review`; fix every real finding with a regression test and repeat until clean.
- [ ] **Step 4: Run** `/plan-eng-review` of the whole of M2 against the original spec (protocol section 6): mismatches go to `PROGRESS.md` and are fixed before the push.
- [ ] **Step 5: Update PROGRESS.md** (M2 closed, decisions, test counts, the DONE_PENDING_ENV and DONE_UNCONFIRMED lists, TODOS carry-overs), commit `docs: record the M2 milestone gate`, push once with `run_in_background` after the gates pass, then record M3 (the roadmap `docs/superpowers/plans/2026-10-23-m3-r1-breadth-roadmap.md`, first slices KERNEL-1, MDM-1, ISS-1) as the next step.

## Parallel execution (maximum 5 agents)

Wave 1 (five lanes in parallel): Lane A Task 1 then 2; Lane B Task 6 then 9; Lane C Task 10 then 12; Lane D Task 17; Lane E Task 16 then 15. Wave 2: Task 3 after 2; Task 4 after 2 (Lane A); Task 7 after 6 and 9; Task 11 after 10; Task 13 after 12; Task 18 after 17; Task 20 after 16. Wave 3: Task 5 after 4; Task 8 after 2, 4, 6; Task 14 after 13; Task 19 after 18 and 20; Task 21 after 20 (Task 18 supplies the DOC-004 and KERNEL-003 part); Task 22 after most tasks (the test-title rename touches many files: run it alone, when no other agent is editing tests). Task 23 last, alone. Shared files that agents append to and that the integrating agent merges: `apps/api/src/app.module.ts` (prefer the module registry instead), `packages/db/src/index.ts`, `apps/api/src/routes` registry of screens (`apps/web/src/routes/screens/index.ts`), both i18n catalogues, `apps/web/e2e/visual.spec.ts`, `docs/runbooks/web-e2e.md`, `apps/api/test/authz/matrix-commands.json`, root `package.json`: each agent re-reads the file right before editing and stages only its own hunks. Browser runs one at a time through the lock; database-backed runs one at a time through the db lane; Tasks 1 to 22 all run `npm run test:lane` style commands when two agents are active.

## Self-Review

- **Spec coverage:** every R0 story that is not DONE has a task: SAS-001 (reads: gap 4; real infrastructure: ports in Tasks 8 and 20), SAS-003 to SAS-006 (Tasks 1 to 5, 8), ADM-002 and ADM-001 follow-ups (Task 12), ADM-003 (10), ADM-006 and 007 (6, 7), ADM-008 and 009 (11), IAM-002 (the port, the web client and the chooser exist since M2e; Keycloak itself is an external blocker, DONE_PENDING_ENV), IAM-005 (9), DOC-001..005 (17 to 19), KERNEL-001..006 (21, 18, 20), 011, 012, 014, 015, 040, 041, 042, 044 (20), 013 (16), 022 (20: the Temporal activity part), 024, 025, 026 (15), 027 and 030 (16), 031 (22: F5 packet), 034 (the test data platform: fixture loader and synthetic generator: **not planned in a task**: it is covered by the shared template database of K0 for fixtures; the synthetic generator and masked refresh are added to Task 21's follow-up list and marked NOT STARTED in the gate unless Task 16's agent has room), 050 (13), 051 (14), ADM-004 and ADM-005 screen contract checks (the UI-ADM-01 and UI-ADM-03 tool: Task 22 documents the regions that stand in for it until the tool is identified).
- **Gaps in this plan itself:** the UI screen-contract check tool named by ADM-004 and ADM-005 (`UI-ADM-01`, `UI-ADM-03`) is not identified in the repository; Task 22 documents the gated regions that stand in for it, and the gate (Task 23 step 1) fails if a story is neither DONE nor tracked.
- **Type consistency:** `LicenseKeyStore`, `licenseStatusAt`, `ObjectStoragePort`, `SigningPort`, `OrchestratorPort`, `Scheduler`, `AlertRule` are each defined once and consumed by later tasks as named in their Interfaces; migration numbers V010 to V017 are unique and match the allocation table.
- **Review Focus:** each line has a test: invitation single use and constant-time compare (Task 6), suspended tenant immediate effect (1), license windows and tenant mismatch (2), theme rejection and review binding (4), legal hold purge paths (10), deterministic PDF and incremental updates (17, 18), scope performance with `EXPLAIN` (9), scheduler single owner and crash release (12).
- **Proportion:** 23 tasks of one test cycle each for 31 stories plus five process items; DOC (Tasks 17 to 19) and infrastructure (Task 20) are the largest and may split at execution time if a test cycle grows past one agent session.
