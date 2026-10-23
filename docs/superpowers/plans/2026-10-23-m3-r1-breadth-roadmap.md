# M3 to M6 Breadth Roadmap (R1 breadth, R2, R3, R4 and UAT)

> **For agentic workers:** this is a roadmap, not a task plan. Use it to pick the next slice or kit, then write a task-level plan for that unit with superpowers:writing-plans (the format of M2a to M2d) before executing it with superpowers:subagent-driven-development. The first kits, whose task-level breakdown is in "First three slices and their kits", can be executed from this file.

**Goal:** Finish MACHVON from the state after M2d (shell, tokens, client, ADM-01 and ADM-03, 13 operations) to the R4 exit (UAT-COVERAGE 100 percent) with up to five agents in parallel on a memory-constrained Windows machine, without agents colliding on shared files, tables or test lanes.

**Architecture:** Work is cut into 38 R1 slices (work packages of one module, a band of the dependency graph, at most 12 stories and about 360 agent-hours) plus 14 shared kits. Agents are dispatched from the story dependency graph, not from slice boundaries; slices only fix ownership of files and tables. Kits make a slice thin: a screen is a configuration of a kit family over generated contracts, a command is a controller on the M2b pipeline over generated validators.

**Tech Stack:** As M2a to M2d (NestJS, PostgreSQL RLS, React and Vite, Flutter for mobile, Temporal behind a port, Keycloak behind a port).

**Spec:** `Design/MACHVON_Design/03_Engineering/implementation_plan.json` (401 stories, 2,146 tasks), `implementation_backlog.json`, `screen_catalog.json` (478 screens: 406 web, 72 mobile), `navigation_architecture.json`, `test_cases.json` (1,097 cases), `01_Documents/09_Ke_hoach_trien_khai.md` (release gates), `01_Documents/06_UI_UX_Design_System.md` (D-B11), `AUTONOMOUS_EXECUTION_PROTOCOL.md`. Numbers below come from analysis scripts over those files (kept outside the repository; rerun them when the plan JSON changes); counts of the JSON differ slightly from the summary table of document 09 (R0 57 here against 54, R1 203 against 205).

## 1. Where the work stands

| Release | Stories | Commands / reads (distinct operations) | New web / mobile screens (first release) | Agent-hours max (min) | Human review hours max |
|---|---|---|---|---|---|
| R0 foundations | 57 (42 not done) | 55 / 22 | 27 / 0 | 2,648 (1,270); remaining 1,884 | 259 |
| R1 breadth (M3) | 203 | 478 / 103 | 270 / 53 | 8,626 (4,196) | 626 |
| R2 depth (M4) | 99 | 136 / 20 | 107 / 16 | 3,798 (1,830) | 246.5 |
| R3 integrations and AI (M5) | 22 | 3 / 0 | 2 / 3 | 1,134 (512) | 75 |
| R4 hardening, UAT (M6) | 20 | 0 / 0 | 0 / 0 | 1,046 (408) | 176 |

Done in the repository after M2d: 13 operations (7 commands for organisation units, roles and grants; 6 reads) and 2 screens (ADM-01, ADM-03); 15 R0 stories treated as done (KERNEL-010/020/021/022/023/026/030/031/111, IAM-001/004, ADM-001/002/004/005; KERNEL-030 and -031 are done for the API and web scope, the Dart client and Flutter ThemeData remain in M2e; KERNEL-023 lacks job scheduling and alert routing) and 3 partial (KERNEL-024/027/028). So 476 of 478 screens and about 806 of 819 story operations remain. Agent-hours are the plan's own effort estimate used as a capacity measure, not a calendar; calibrate with the throughput of the first slice (decision D9).

## 2. Residual R0 (M2e): ports first, environment later

42 R0 stories are open (1,884 agent-hours); 29 of them (marked * below) are prerequisites of R1 stories.

| Track | Stories | Agent-hours | Notes |
|---|---|---|---|
| A. Software only (start now) | 25: DOC-001*, DOC-002*, DOC-003*, DOC-005*, KERNEL-013, KERNEL-024*, KERNEL-025, KERNEL-027, KERNEL-028*, KERNEL-034, KERNEL-050*, KERNEL-051*, IAM-005, ADM-003*, ADM-006*, ADM-007, ADM-008, ADM-009, SAS-001*, SAS-002*, SAS-003*, SAS-004*, SAS-005, SAS-006, NOT-001* | 1,156 | Documents engine (DOC-001/002/003/005), notification core, tenant registry, entitlement, license, theme, members and invitations, security policy, legal hold, certificate registry, telemetry code, test data platform, cache and object-storage ports, command conformance. Every external component sits behind a port with a local adapter (in-memory orchestrator, filesystem object store, in-process search) so R1 slices are not blocked. |
| B. Environment-bound (needs servers, accounts, a CA sandbox) | 17: DOC-004, KERNEL-001*, KERNEL-002*, KERNEL-003, KERNEL-004*, KERNEL-005*, KERNEL-006*, KERNEL-011*, KERNEL-012, KERNEL-014*, KERNEL-015*, KERNEL-040*, KERNEL-041*, KERNEL-042*, KERNEL-044*, IAM-002*, IAM-003* | 728 | Six spikes, infrastructure as code, secrets, deployment pipeline, production PostgreSQL, object storage and Redis, Keycloak, Temporal, sign-in and tenant selection. Run as a separate lane when an environment exists; each component enters only with runbook, restore test and alert (document 09, R1 decision). |

## 3. Cross-cutting kits

A kit is built once and consumed by many slices. IDs K0 to K13 are used in the slice table.

| Kit | What | Plan stories | Interfaces (summary) | Needed by |
|---|---|---|---|---|
| K0 | Test lanes and one shared database per run | new | `scripts/lane.mjs` lock-file lanes (`db`, `browser`) with stale-lock timeout and FIFO queue; global setup starts one embedded PostgreSQL, applies all migrations once into a template database; `withTestDatabase()` clones it with `CREATE DATABASE … TEMPLATE` in about 100 ms; replaces per-suite server start | every slice |
| K1 | Module registry and migration blocks | new | `apps/api/src/modules/<mod>/` and `apps/web/src/modules/<mod>/` own controllers, screens, i18n, tests; generated `modules.generated.ts` (API) and `screens.generated.ts` plus merged i18n catalogues (web); `npm run modules:generate` and `modules:check`; migration files `V<block><seq>__<slice>_<name>.sql` with a reserved block per slice | every slice (removes edits to `app.module.ts`, `db/index.ts`, `routes/screens/index.ts`, i18n catalogues) |
| K2 | Generated request validation | extends ST-KERNEL-030 | Ajv standalone validators generated from `openapi.json` request schemas; the `@Command` interceptor validates the body, answers `FIELD_NOT_ALLOWED` / `INVALID_REQUEST` / `VALIDATION_FAILED`, and exposes the typed body; response allowlist from `x-exposure`; replaces hand-written parsers such as `iam-dto.ts` | 478 R1 commands |
| K3 | UI kit | ST-KERNEL-032 (90h) | families by screen kind (R1 web screens: table 71, form 37, list 16, policy 14, approval 14, detail 11, review 9, board 8, compare 8, timeline 8, dashboard 8, funding 7, confirm 7, import 7, tree 7, reconcile 5, workflow 5, documents 4, cards 4, calendar 4, kanban 3, editor 3, criteria 3, cost 3, map 2, offline 1, keys 1, chart 1, allocation 1, success 1, rank 1): `DataTable`, `CommandForm` (from OPERATIONS and K2), `EntityDetail`, `DecisionPanel`, `WorkflowTimeline`, `PermissionMatrix` (ADM-03 prior art), `UnitTree` (ADM-01 prior art), `Board`, `Timeline`, `DiffView`, `MetricTile`/`ChartFrame`, `CalendarView`, `ImportWizard`, `DocumentList`; each family has seven-state demos and a visual baseline | every web slice |
| K4 | Slice and screen scaffolds | new | `npm run slice:new -- MDM-1` and `screen:new -- MDM-25`: folders from K1, screen module from `screen_catalog.json` fields bound to contract operations, i18n skeleton, test skeletons, UAT-COVERAGE rows | every slice |
| K5 | UAT-COVERAGE generator | ST-KERNEL-090 (28h) | lists every screen and function of the plan with evidence links, updated by each slice commit; `npm run uat:coverage` | protocol section 9 |
| K6 | Import, provider callbacks, money integrity | ST-KERNEL-070 (52h), -071 (40h), -072 (44h) | idempotent file import with hashes, quarantine and reconciliation; provider callback kernel (signature, inbox dedupe, monotonic status reducer); row-lock ordering and balance-constraint harness | MDM, CAP, DIS, CTR, PAY, LND |
| K7 | Legal rules as dated data and CXN gate | ST-KERNEL-060 (36h), -110 (14h) | effective-date resolver, templates, a gate that marks a slice DONE_UNCONFIRMED until its CXN items are confirmed or waived | slices with CXN (see table) |
| K8 | Maker-checker and versioned records | new (small) | `assertFourEyes`, `ChangeRequest` aggregate with impact preview hook, version and supersede helpers | MDM-001/008, SAS-009, DOC |
| K9 | Approval engine and orchestration port | ST-ADM-012 (80h), -013, KERNEL-005/044 | configurable workflow runner behind an `Orchestrator` port; in-memory adapter now, Temporal adapter when the environment exists; domain transition guard | approval, review and workflow screens (28 in R1) |
| K10 | Documents services | ST-DOC-001/002/003/005 | PDF render port, number registers, PAdES verification, outgoing document aggregate; external-signature upload is the R1 main path while no CA sandbox exists | DOC, AUD, CTR |
| K11 | Notification core | ST-NOT-001 (64h) | event to inbox with dedupe, read and acknowledge | NOT, OMNI, every slice that notifies |
| K12 | Files, search, export, dashboards | ST-KERNEL-024/025, MOB-009, KERNEL-061 | object storage port with short-lived URLs and upload validation, tenant-filtered search projection, scheduled export with re-authorisation, personal-data masking; chart library decision (pending) | DOC, BI, DGV, HOME |
| K13 | Operational kernels | ST-KERNEL-050/051/073/074 | OpenTelemetry with PII allowlist, alert rules, degradation banner, per-tenant quotas | all, last (R4 gates) |
| K13m | Mobile kit | ST-MOB-001/005/006/009 | Flutter foundation, offline command queue, draft conflicts, resumable upload | MOB slices |

## 4. R1 slices

Slices are the unit of ownership. Within a slice an agent works story by story; each story's tasks (db, backend, web, i18n, security, qa, observability) stay with one agent because they share files. Columns: commands/reads are distinct operations of the slice's stories; web and mobile are catalogue screens (two mobile screens carry a QMS or DOC id prefix and are counted under web); hours are the plan's maximum estimate; level is the wave in the slice graph; R0×n is the number of open R0 stories the slice depends on (list per slice in the generator output, see decision D10).

| Slice | Module | Stories | Cmd/Read | Web | Mob | Tables | Agent-h | Level | Depends on | Kits | CXN | UAT ids |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| KERNEL-1 | KERNEL | 7 (KERNEL-032…KERNEL-110) | 0/0 | 0 | 0 | 0 | 304 | 0 | - | K6 K7 | 1 | 16 |
| DGV-1 | DGV | 4 (DGV-001, DGV-002, DGV-003, DGV-004) | 14/8 | 9 | 0 | 9 | 184 | 0 | - | K0 K1 K2 K3 K6 K9 K12 | 1 | 12 |
| DIS-1 | DIS | 2 (DIS-001, DIS-002) | 5/2 | 2 | 0 | 2 | 70 | 1 | MDM-1 | K0 K1 K2 K3 K9 | 0 | 6 |
| ISS-1 | ISS | 5 (ISS-001…ISS-005) | 14/2 | 8 | 0 | 4 | 134 | 0 | - | K0 K1 K2 K3 K9 | 1 | 10 |
| MDM-1 | MDM | 9 (MDM-001…MDM-009) | 21/4 | 34 | 0 | 8 | 288 | 0 | - | K0 K1 K2 K3 K6 K7 K9 | 6 | 22 |
| MOB-1 | MOB | 4 (MOB-001, MOB-005, MOB-006, MOB-009) | 3/1 | 0 | 6 | 2 | 322 | 0 | R0×3 | K0 K1 K2 K6 K13m | 0 | 16 |
| KERNEL-2 | KERNEL | 7 (KERNEL-033…KERNEL-074) | 0/0 | 0 | 0 | 0 | 256 | 0 | R0×8 | - | 1 | 15 |
| LLM-1 | LLM | 6 (LLM-001…LLM-006) | 24/8 | 15 | 0 | 17 | 320 | 0 | - | K0 K1 K2 K3 K6 K9 K12 | 2 | 19 |
| MOB-2 | MOB | 6 (MOB-002…MOB-013) | 0/0 | 0 | 15 | 1 | 402 | 1 | KERNEL-2, MOB-1, R0×4 | K0 K1 K2 K6 K9 K13m | 1 | 27 |
| PMT-1 | PMT | 6 (PMT-001…PMT-005) | 15/0 | 6 | 0 | 6 | 130 | 1 | ISS-1 | K0 K1 K2 K3 K7 | 2 | 8 |
| PRJ-1 | PRJ | 5 (PRJ-001…PRJ-004) | 20/2 | 10 | 0 | 6 | 216 | 1 | MDM-1 | K0 K1 K2 K3 K6 K7 K9 | 4 | 17 |
| DOC-1 | DOC | 9 (DOC-006…DOC-014) | 40/0 | 11 | 0 | 8 | 280 | 0 | R0×4 | K0 K1 K2 K3 K6 K9 K10 K12 | 10 | 19 |
| IAM-1 | IAM | 2 (IAM-007, IAM-006) | 4/0 | 3 | 0 | 1 | 40 | 2 | NOT-1, R0×1 | K0 K1 K2 K3 | 0 | 7 |
| MOB-3 | MOB | 3 (MOB-008, MOB-010, MOB-014) | 0/0 | 0 | 16 | 0 | 304 | 2 | MOB-1, MOB-2 | K0 K1 K2 K6 K12 K13m | 1 | 23 |
| OMNI-1 | OMNI | 1 (OMNI-001) | 4/2 | 2 | 0 | 1 | 40 | 2 | ADM-1, NOT-1, R0×1 | K0 K1 K2 K3 K11 | 0 | 4 |
| ADM-1 | ADM | 10 (ADM-010…ADM-015) | 22/6 | 11 | 0 | 12 | 426 | 0 | R0×5 | K0 K1 K2 K3 K6 K7 K9 | 9 | 33 |
| AUD-1 | AUD | 5 (AUD-001…AUD-005) | 23/0 | 9 | 0 | 9 | 188 | 1 | DOC-1 | K0 K1 K2 K3 K6 K9 K10 K12 | 2 | 11 |
| BID-1 | BID | 7 (BID-002…BID-007) | 18/8 | 11 | 0 | 13 | 208 | 1 | DOC-1 | K0 K1 K2 K3 K6 K9 | 3 | 9 |
| CAP-1 | CAP | 8 (CAP-001…CAP-008) | 19/4 | 15 | 0 | 10 | 370 | 2 | DIS-1, KERNEL-1, MDM-1, PRJ-1 | K0 K1 K2 K3 K6 K7 K9 K10 | 5 | 29 |
| CTR-1 | CTR | 7 (CTR-001…CTR-007) | 25/10 | 12 | 0 | 9 | 254 | 3 | ADM-1, CAP-1, PMT-1 | K0 K1 K2 K3 K6 K7 K12 | 4 | 18 |
| DIS-2 | DIS | 8 (DIS-003…DIS-017) | 12/6 | 15 | 0 | 5 | 402 | 3 | CAP-1, DIS-1, MDM-1, PRJ-1 | K0 K1 K2 K3 K6 K9 K12 | 1 | 31 |
| MOB-4 | MOB | 3 (MOB-011, MOB-015, MOB-012) | 0/0 | 0 | 14 | 0 | 284 | 3 | KERNEL-2, MOB-1, MOB-3, R0×1 | K0 K1 K2 K6 K9 K12 K13m | 3 | 18 |
| NOT-1 | NOT | 6 (NOT-002…NOT-007) | 14/8 | 10 | 0 | 5 | 312 | 1 | ADM-1, R0×3 | K0 K1 K2 K3 K7 K9 K11 | 3 | 28 |
| QMS-1 | QMS | 6 (QMS-001…QMS-006) | 24/4 | 9 | 0 | 7 | 236 | 4 | CTR-1, MOB-2, PMT-1 | K0 K1 K2 K3 K7 K9 K12 | 2 | 13 |
| SAS-1 | SAS | 1 (SAS-013) | 2/0 | 1 | 0 | 0 | 32 | 4 | SAS-2 | K0 K1 K2 K3 K6 K7 | 1 | 2 |
| SAS-2 | SAS | 10 (SAS-017…SAS-012) | 27/8 | 13 | 0 | 9 | 432 | 3 | ADM-1, IAM-1, R0×7 | K0 K1 K2 K3 K6 K7 K9 K12 | 4 | 34 |
| AST-1 | AST | 3 (AST-001, AST-002, AST-003) | 11/4 | 4 | 0 | 5 | 92 | 6 | CTR-2, QMS-1 | K0 K1 K2 K3 K6 K7 K9 | 3 | 6 |
| CTR-2 | CTR | 3 (CTR-008, CTR-009, CTR-011) | 9/4 | 2 | 0 | 3 | 94 | 5 | CTR-1, PMT-1, QMS-1 | K0 K1 K2 K3 K6 K9 | 1 | 7 |
| PAY-1 | PAY | 4 (PAY-006, PAY-001, PAY-002, PAY-003) | 12/4 | 7 | 0 | 10 | 228 | 6 | CAP-1, CTR-1, CTR-2, KERNEL-1 | K0 K1 K2 K3 K6 K10 K12 | 3 | 18 |
| BI-1 | BI | 4 (BI-001, BI-002, BI-003, BI-004) | 7/4 | 8 | 0 | 7 | 180 | 9 | DGV-1, DIS-3 | K0 K1 K2 K3 K6 K12 | 0 | 13 |
| CAP-2 | CAP | 2 (CAP-006, CAP-010) | 5/0 | 1 | 0 | 2 | 110 | 9 | CAP-1, DIS-3, KERNEL-1, PAY-2 | K0 K1 K2 K3 K6 | 4 | 6 |
| CTR-3 | CTR | 3 (CTR-010, CTR-013, CTR-012) | 2/0 | 1 | 0 | 1 | 58 | 9 | AST-1, CTR-2, ISS-1, LND-1, PAY-1, PAY-2 | K0 K1 K2 K3 K6 K7 K12 | 1 | 5 |
| DIS-3 | DIS | 7 (DIS-009…DIS-016) | 10/0 | 8 | 0 | 5 | 312 | 8 | CAP-1, DIS-1, DIS-2, KERNEL-1, MDM-1, PAY-2, PRJ-1 | K0 K1 K2 K3 K6 K7 K9 | 4 | 22 |
| HOME-1 | HOME | 5 (HOME-001…HOME-005) | 5/0 | 9 | 0 | 0 | 224 | 10 | CAP-1, CAP-2, DIS-2, DIS-3, MNE-1, PRJ-2 | K0 K1 K2 K3 K6 K7 K12 | 2 | 18 |
| LND-1 | LND | 10 (LND-001…LND-007) | 27/0 | 11 | 0 | 11 | 302 | 8 | CTR-1, ISS-1, PAY-1, PAY-2 | K0 K1 K2 K3 K6 K7 K9 K12 | 4 | 15 |
| MNE-1 | MNE | 7 (MNE-001…MNE-007) | 16/0 | 7 | 0 | 4 | 286 | 9 | DIS-3, MDM-1 | K0 K1 K2 K3 K6 K7 K9 K10 | 5 | 19 |
| PAY-2 | PAY | 6 (PAY-004…PAY-010) | 18/4 | 10 | 0 | 4 | 236 | 7 | CTR-1, CTR-2, KERNEL-1, PAY-1 | K0 K1 K2 K3 K6 K7 K9 K10 K12 | 5 | 15 |
| PRJ-2 | PRJ | 2 (PRJ-007, PRJ-006) | 6/0 | 2 | 0 | 2 | 70 | 9 | DIS-3, MDM-1, PRJ-1 | K0 K1 K2 K3 K9 | 1 | 4 |
| **Total** | | **203** | **478/103** | **276** | **51** | | **8,626** | | | | | |

Waves (slice graph levels; slices in one level can run in parallel once their dependencies are done):

| Level | Number of slices | Agent-hours | Slices |
|---|---|---|---|
| 0 | 9 | 2514 | KERNEL-1, DGV-1, ISS-1, MDM-1, MOB-1, KERNEL-2, LLM-1, DOC-1, ADM-1 |
| 1 | 7 | 1526 | DIS-1, MOB-2, PMT-1, PRJ-1, AUD-1, BID-1, NOT-1 |
| 2 | 4 | 754 | IAM-1, MOB-3, OMNI-1, CAP-1 |
| 3 | 4 | 1372 | CTR-1, DIS-2, MOB-4, SAS-2 |
| 4 | 2 | 268 | QMS-1, SAS-1 |
| 5 | 1 | 94 | CTR-2 |
| 6 | 2 | 320 | AST-1, PAY-1 |
| 7 | 1 | 236 | PAY-2 |
| 8 | 2 | 614 | DIS-3, LND-1 |
| 9 | 5 | 704 | BI-1, CAP-2, CTR-3, MNE-1, PRJ-2 |
| 10 | 1 | 224 | HOME-1 |

**Critical path (slice level, maximum hours 2744, minimum 1344):** MDM-1 → PRJ-1 → CAP-1 → CTR-1 → QMS-1 → CTR-2 → PAY-1 → PAY-2 → DIS-3 → MNE-1 → HOME-1.
**Critical path (story level, 1220 agent-hours):** ST-MDM-001 → ST-MDM-002 → ST-MDM-003 → ST-PRJ-001 → ST-PRJ-002 → ST-CAP-002 → ST-CAP-003 → ST-CAP-005 → ST-CTR-004 → ST-CTR-006 → ST-CTR-007 → ST-CTR-008 → ST-CTR-009 → ST-PAY-001 → ST-PAY-002 → ST-PAY-003 → ST-PAY-005 → ST-PAY-007 → ST-DIS-009 → ST-DIS-010 → ST-MNE-002 → ST-MNE-003 → ST-MNE-004 → ST-MNE-006.
The path runs through the capital chain (master data, project, capital plan, contract, payment, disbursement, monitoring, home dashboard). Total R1 effort is 8,626 agent-hours, about 1,725 per agent with five agents. If whole slices are the unit of dispatch the slice path (2744 h) is longer than that and sets the duration; if stories are dispatched as soon as their own dependencies are done, the story path (1220 h) is shorter than the per-agent load and capacity sets the duration. This is why dispatch is by story (decision D1) and why ports for CAP and PAY inputs (K6) are built early.

Shared tables across slices: `retention_hold` (PAY-1, CTR-3); the owning slice is the earlier one, the other adds only columns through its own migration block.

## 5. Execution model

- **Dispatch:** one agent per story, WIP at most 5 (memory note in the project memory). The dispatcher (the main agent) picks stories in order of remaining critical-path hours, then module affinity (an agent that just finished a story of a slice takes the next unblocked story of that slice to keep context).
- **File ownership:** after K1 an agent edits only its module folders, its migration block and generated files through the generators; shared files are touched only by the integrator in a separate commit. Codex review runs per commit, one at a time, in the background.
- **Test lanes (K0):** (1) unit and component tests, in parallel, up to four workers per run; (2) `db` lane: integration tests on the shared template database, one run at a time through the lock; (3) `browser` lane: Playwright route walks and visual specs, one run at a time; (4) `verify` lane: the full gate set before a slice is closed and before a push, one at a time, by the integrator. Agents run only the tests of the files they touch, then the integrator runs the full gates; no agent starts a push.
- **Slice definition of done:** every acceptance criterion of every story has a test; every operation is in the contract and every command has a negative-matrix row (`commands:check`); every screen has the seven states, i18n keys in both languages, an `ui-runtime-audit` pass and a visual comparison per the harness; CXN items either confirmed or the slice marked DONE_UNCONFIRMED; migrations in the slice's block; UAT-COVERAGE rows updated; PROGRESS.md updated; Codex review clean.
- **UAT-COVERAGE (protocol section 9):** the generator (K5) is built first and fed from `implementation_plan.json` and `screen_catalog.json`: one row per screen and per function, status columns written by each slice. The R1 exit gate (document 09: main flow per module, permissions, audit, core screens; financial flow correct against golden fixtures; maker-checker; period lock; allocation contention; offline conflicts; one reporting period run on golden fixtures; no open P0/P1) is a roll-up of the slice UAT ids; the final write-run-fix cycle of section 9 runs in M6 with the uat-test-writer and uat-test-runner skills over the whole matrix.
- **Calibration:** after the first slice closes, compare actual elapsed time and tokens with its agent-hours and rescale the roadmap; no calendar promise is made before that.

## 6. Later milestones

| Module | R2 (M4) stories / ops / web / hours | R3 (M5) | R4 (M6) |
|---|---|---|---|
| ADM | 2s / 4o / 3w / 96h | - | - |
| AST | 3s / 8o / 3w / 58h | - | - |
| AUD | 2s / 0o / 2w / 52h | - | - |
| BI | 5s / 14o / 10w / 188h | 1s / 0o / 0w / 44h | - |
| BID | 6s / 16o / 10w / 236h | 2s / 0o / 0w / 84h | - |
| CAP | 5s / 6o / 5w / 152h | 1s / 0o / 0w / 44h | 1s / 0o / 0w / 12h |
| CTR | 4s / 8o / 10w / 100h | - | - |
| DGV | 6s / 24o / 12w / 208h | 1s / 0o / 0w / 28h | - |
| DIS | 5s / 1o / 1w / 162h | 1s / 0o / 0w / 40h | 1s / 0o / 0w / 20h |
| DOC | 6s / 10o / 7w / 196h | 2s / 3o / 1w / 108h | - |
| HOME | 2s / 0o / 1w / 70h | - | - |
| IAM | 1s / 1o / 1w / 48h | - | - |
| ISS | 3s / 1o / 4w / 56h | - | - |
| KERNEL | 6s / 0o / 0w / 374h | 3s / 0o / 0w / 164h | 13s / 0o / 0w / 812h |
| LLM | 3s / 4o / 6w / 116h | 2s / 0o / 0w / 56h | - |
| LND | 2s / 3o / 2w / 46h | - | - |
| MDM | 3s / 4o / 4w / 98h | - | 1s / 0o / 0w / 10h |
| MNE | 4s / 3o / 3w / 122h | 1s / 0o / 0w / 56h | 1s / 0o / 0w / 20h |
| MOB | 8s / 0o / 0w / 532h | 3s / 0o / 0w / 174h | 2s / 0o / 0w / 160h |
| NOT | 3s / 6o / 5w / 144h | 1s / 0o / 0w / 96h | - |
| OMNI | 6s / 22o / 8w / 272h | 2s / 0o / 1w / 128h | - |
| PAY | 2s / 3o / 3w / 66h | - | - |
| PMT | 1s / 0o / 1w / 18h | - | - |
| PRJ | 5s / 9o / 8w / 142h | 1s / 0o / 0w / 48h | 1s / 0o / 0w / 12h |
| QMS | 2s / 3o / 2w / 38h | - | - |
| SAS | 4s / 6o / 4w / 208h | 1s / 0o / 0w / 64h | - |

- **M4 (R2, depth):** 99 stories, 3,798 agent-hours: contract to settlement without double counting, land clearance, state document and report forms, BI drill, data governance, multi-channel notification. Same slice and kit method; plan it with the same generator once R1 is at wave 6, because its stories depend on R1 slices. R2 entry requires the legal confirmation ledger entries for the rules it uses (document 09).
- **M5 (R3, integrations and AI):** 22 stories, 1,134 agent-hours: treasury, digital signature, external channels, production AI. Entry requires D05 to D07 contracts, sandboxes and vault credentials; until then the adapters stay behind ports with honest status ("not connected"), and contract tests run against recorded sandbox fixtures.
- **M6 (R4, hardening and rollout):** 20 stories, 1,046 agent-hours (13 kernel stories, 812h): penetration test, load, accessibility, disaster recovery, mobile upgrade and rollback, UAT sign-off, pilot. Exit: UAT-COVERAGE.md 100 percent PASS, critical cases (money, isolation, restore) 100 percent, runbook drills, SLO and RPO/RTO fixed (D10).

## 7. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Legal confirmation ledger: 49 CXN items touched by R1 stories (58 in total) | a slice using an unconfirmed rule cannot be DONE | K7 gate and a confirmation window (ST-KERNEL-110) early in M3; slices proceed as DONE_UNCONFIRMED and are listed in UAT-COVERAGE |
| Golden data D03 and mapping D04 not signed | financial slices cannot claim number-correct flows | proposals drafted and marked CHỜ KÝ; golden fixtures used as oracle only after signing |
| External integrations D05 to D07 (treasury, CA, channels) | R3 blocked | ports with local adapters, upload-signed-document path for R1, sandbox recorded fixtures |
| Spikes not run (Temporal, PowerSync, PAdES CA sandbox, AI model, Flutter, cloud RPO/RTO) | wrong infrastructure choice discovered late | schedule the six spike stories (ST-KERNEL-001 to -006, 280 agent-hours) as lane B at the start of M2e so their conclusions arrive before the slices that depend on them (DOC-1, LLM-1, MOB-1, NOT-1) |
| 72 mobile screens (53 first needed in R1) need the Flutter toolchain, emulators and device testing | memory and tooling not verified on this machine | check the toolchain at the start of M2e; MOB slices only depend on KERNEL-2 and MOB-1, so web slices are not blocked |
| Memory-constrained machine (embedded PostgreSQL, Playwright) | flaky or hung suites, agents blocked | K0 first; one shared database per run; lanes; never more than one browser run; orphan cleanup limited to repository processes |
| Critical path (11 slices) | late finish regardless of agents | story-level dispatch, ports for CAP and PAY inputs early, start MDM-1 first |
| Design drift (change requests so far: openapi additions, membership.scope_version, outbox relay policy, role matrix sign-off) | design package and code diverge | every divergence goes through the change register and TODOS.md the same day; design gates stay mandatory in CI |
| Human review capacity (R1 626 h maximum of required review hours) | reviews queue behind agents | batch review per slice; review tags (authorization, money, migration, legal-rule, privacy) drive who reviews; Codex review on every commit as first filter |
| Hand-written validation and screens do not scale to 478 commands and 270 screens | inconsistency, rework | K2, K3, K4 before the second slice starts |

## 8. Decisions taken without asking (also to be written to PROGRESS.md)

| # | Point | Decision | Basis |
|---|---|---|---|
| D1 | Slicing | Slices are ownership units; dispatch is by the story graph, critical path first | slice graph is acyclic only at coarse granularity; stories carry the real dependencies |
| D2 | Shared-file conflicts | K1 module registry and generators remove edits to shared files; migration blocks reserve numbers per slice (`V<1000 + 20 × slice index>`, slice index in table order) | three parallel forks already collided on `index.ts`, `app.module.ts` and i18n files in M2c and M2d |
| D3 | Infrastructure | Every external component behind a port with a local adapter; real infrastructure is lane B | document 09 R1 decision (components enter with first need, runbook, restore test, alert) |
| D4 | Test cost | K0 (lanes, shared template database) is the first M2e task | 24 database suites already start 24 servers; R1 adds hundreds |
| D5 | Validation | Generated validators (K2) replace hand-written parsers | 478 R1 commands |
| D6 | UI | Screens are configurations of K3 families with visual comparison on the frame and card regions; full-page pixel targets only where the mockup content is real | ADM-01/ADM-03 experience in M2d |
| D7 | Mobile | Separate lane starting when the Flutter toolchain is verified; does not block web slices | MOB slices depend only on KERNEL-2 and MOB-1 |
| D8 | Legal confirmation | Slices with CXN items finish as DONE_UNCONFIRMED and appear in UAT-COVERAGE until the owner confirms or waives | document 09 and ledger rule R4 |
| D9 | Estimates | Agent-hours are capacity weights; calibrate after slice 1 | effort field is an assumption with medium or low confidence |
| D10 | Per-slice R0 dependencies | Listed in the appendix; M2e closes them in dependency order (track A first) | slices must not start before their R0 prerequisites exist as ports |
| D11 | Slice caps | 12 stories and about 360 agent-hours; small same-module slices merged when the slice graph stays acyclic | analysis |

## 9. First three slices and their kits

Recommended start right after M2e: **KERNEL-1** (the shared kernel stories: ST-KERNEL-032 UI kit, -060 legal rules, -070 import framework, -071 provider callbacks, -072 money harness, -090 UAT-COVERAGE, -110 legal confirmation window), **MDM-1** (master data: head of the critical path, 34 web screens of kinds table, tree, form, approval, import: it exercises every K3 family and K6 import), and **ISS-1** (issues and SLA: a leaf slice with no cross-slice dependency, 16 operations, 8 screens, good for proving the slice template while the critical path starts). **PRJ-1** starts as soon as MDM-1's master-record read operations exist (level 1). With five agents: A1 K0 then K1, A2 K2 and K8, A3 K3 and K4, A4 MDM-1 stories (after K1 freezes the module layout), A5 residual R0 track A and ISS-1.

The kits those three slices need first, as tasks (Files, Interfaces, Steps in the format of the M2 plans). Each is committed on its own; agents do not push.

### Task K0: Test lanes and the shared template database

**Files:**
- Create: `scripts/lane.mjs` and `scripts/lane.test.mjs`, `packages/db/src/template-database.ts`, `packages/db/test/template-database.test.ts`, `packages/db/jest.global-setup.ts`, `packages/db/jest.global-teardown.ts`
- Modify: `packages/db/src/test-database.ts` and `apps/api/test/isolation/test-app.ts`, `apps/api/test/command-harness.ts` (use the template database), `packages/db/package.json` and `apps/api/package.json` (jest global setup), root `package.json` (`test:lane`)

**Interfaces:**
- Produces: `runInLane(lane: 'db' | 'browser' | 'verify', work: () => Promise<number>, options?: { staleMs?: number; log?: (line: string) => void }): Promise<number>` (lock file under `.test-locks/`, FIFO queue file, stale holder detected by pid and timestamp); `startSharedDatabase(): Promise<{ adminUrl: string; stop(): Promise<void> }>` (one server per jest run, applies every committed migration once into database `machvon_template`); `withTestDatabase<T>(work: (db: TestDatabase) => Promise<T>): Promise<T>` and `createTestDatabase(): Promise<TestDatabase>` (`CREATE DATABASE … TEMPLATE machvon_template`, the six roles are cluster-wide so they are created once, `stop()` drops the clone); the existing `startTestDatabase` and `startMigratedTestDatabase` keep their signatures and delegate when the shared server exists.

- [ ] **Step 1: Write failing tests**: `runInLane` serialises two concurrent callers (second starts after first ends), reclaims a lock whose pid is dead and one older than `staleMs`, releases on thrown error; the template test clones 20 databases in parallel in under 10 s total, proves a write in one clone is invisible in another, proves roles and RLS work in a clone (the isolation checks of the migration tests), proves `stop()` drops the clone and global teardown stops the single server.
- [ ] **Step 2: Run** `node --test scripts/lane.test.mjs` and the db package tests; expected FAIL.
- [ ] **Step 3: Implement** `runInLane` with atomic `mkdir`-style lock creation and a queue ticket per caller; implement the shared server in jest global setup (port written to an environment variable for workers); keep per-suite server start as the fallback when the variable is absent so single-file runs still work.
- [ ] **Step 4: Run** the whole db and api suites twice; expected PASS, one `postgres.exe` main process during the run, wall time of the db package at most half of today's (record before and after in PROGRESS.md).
- [ ] **Step 5: Commit** `test: add test lanes and a shared template database`.

### Task K1: Module registry, generated composition and migration blocks

**Files:**
- Create: `scripts/modules-generate.mjs` and test, `apps/api/src/modules/README.md`, `apps/api/src/modules.generated.ts`, `apps/web/src/modules.generated.ts`, `apps/web/src/i18n/modules.generated.ts` (merged catalogues), `db/migrations/BLOCKS.md` (table of reserved blocks per slice)
- Modify: `apps/api/src/app.module.ts` (compose from `modules.generated.ts`), `apps/web/src/routes/screens/index.ts` (compose from `screens.generated.ts`), `apps/web/src/i18n/index.ts`, `scripts/architecture-check.mjs` (module boundary rule: a module imports only kernel, db, contracts and its own folder; no module imports another module's internals, only its public `index.ts`), root `package.json` (`modules:generate`, `modules:check` in `lint`)
- Move: the existing ADM organisation-unit and role code into `apps/*/src/modules/adm/` (behaviour unchanged, tests green)

**Interfaces:**
- Produces: a module descriptor `defineModule({ code, controllers, providers, screens, i18n, migrationBlock })` exported from each module's `index.ts`; the generator scans `modules/*/index.ts`, emits the composed Nest module list, the screen map and the catalogue merge in sorted order, refuses duplicate screen ids, duplicate i18n keys across modules and migration blocks outside the module's reserved range; `modules:check` fails on a stale generated file.

- [ ] **Step 1: Write failing tests**: generator output for two fixture modules is deterministic and sorted; duplicate screen id, duplicate key and an out-of-range migration number are each reported with the module names; the architecture rule flags a cross-module internal import and allows the public index import; after moving ADM, every existing test passes unchanged and `ADM-01`, `ADM-03` still resolve.
- [ ] **Step 2: Run** the new tests; expected FAIL.
- [ ] **Step 3: Implement** the generator and move ADM; reserved blocks: slice index in the table of section 4 gives `V<1000 + 20 × index>` to `V<1019 + 20 × index>`.
- [ ] **Step 4: Run** the full verification (`npm test`, lint, typecheck, architecture, commands:check, db:check, contracts:check, routes:check); expected PASS.
- [ ] **Step 5: Commit** `refactor: compose API, screens and catalogues from a module registry`.

### Task K2: Generated request validation

**Files:**
- Create: `packages/contracts/src/validators.generate.ts` (+ test), `packages/contracts/src/validators.generated.ts`, `apps/api/src/validated-body.ts` (+ test)
- Modify: `packages/contracts/package.json` (`contracts:generate` also writes validators, `contracts:check` verifies), `apps/api/src/command.interceptor.ts` (validate before `begin`), `apps/api/src/iam-dto.ts` and `org-unit-dto.ts` (delete hand-written parsers where the generated validators cover them)

**Interfaces:**
- Produces: `validatorFor(operationId: string): (body: unknown) => { ok: true; value: unknown } | { ok: false; problems: Problem[] }` with `Problem = { path: string; code: 'FIELD_NOT_ALLOWED' | 'INVALID_REQUEST' | 'VALIDATION_FAILED'; keyword: string }` (unknown field → `FIELD_NOT_ALLOWED` 400, type or required → `INVALID_REQUEST` 400, pattern, enum, length and range → `VALIDATION_FAILED` 422, with the field name in `detail`, never the value); the interceptor answers the first problem as a Problem+JSON error before the idempotency record is created.

- [ ] **Step 1: Write failing tests**: for `createOrganizationUnit` and `createCustomRole` the generated validator reproduces every case of the existing hand-written tests (unknown field, missing field, wrong type, pattern, enum, length, rank bounds); a request body with 10 MB of nesting is rejected without stack overflow; generation is deterministic and covers all 574 write operations; a body valid for one operation fails another's validator.
- [ ] **Step 2: Run** `npm test -w @machvon/contracts` and the api tests; expected FAIL.
- [ ] **Step 3: Implement** with Ajv standalone code generation (pin an exact version at least two weeks old), emitted as one module; keep `additionalProperties: false` semantics of the contract; the interceptor looks the validator up by the `@Command` operation.
- [ ] **Step 4: Run** `npm test && npm run contracts:check && npm run lint && npm run typecheck`; expected PASS and no behavioural change for the two migrated commands.
- [ ] **Step 5: Commit** `feat(contracts): generate request validators from the OpenAPI schemas`.

### Task K3: UI kit core and screen scaffold (ST-KERNEL-032 subset for MDM-1 and ISS-1)

**Files:**
- Create: `apps/web/src/kit/{DataTable,CommandForm,EntityDetail,DecisionPanel,Board,ImportWizard,UnitTree}/` (each folder: component, model, tests, seven-state demo), `apps/web/src/kit/index.ts`, `scripts/screen-new.mjs` and test
- Modify: `apps/web/e2e/visual.spec.ts` (kit demos as visual cases), move `apps/web/src/modules/adm/.../UnitTree` into the kit with ADM-01 consuming it

**Interfaces:**
- Produces: `DataTable<Row>({ read: ReadOperation; query: Record<string, string | number>; columns: Column<Row>[]; onRowOpen?: (row: Row) => void })` (cursor paging through `readAll` or page-by-page, sortable columns where the contract allows, seven states via `StateBoundary`); `CommandForm<Op extends CommandOperation>({ operation: Op; fields: FieldSpec[]; initial?: Partial<Body>; onDone: (result: CommandResultView) => void })` (one attempt key per user intention, inline server errors on the field named in `detail`, `VERSION_CONFLICT` reload keeping the edit, `MFA_REQUIRED` step-up prompt, read-only when the session lacks the permission of `OPERATIONS[op].permission`); `EntityDetail`, `DecisionPanel` (approve, return, reject with reason and version pin), `Board` (kanban lanes with keyboard move), `ImportWizard` (upload, validate with row-level errors, confirm, K6 contract); `screen:new -- <ID>` writes the screen module, route registration through the module descriptor, i18n skeleton, test skeleton from `screen_catalog.json`.

- [ ] **Step 1: Write failing tests**: component tests per family with a fake client for default, loading, empty, error, denied, expired and offline; `CommandForm` double click sends one request, retry after a lost response reuses the key, a field error from the server shows on the right field without clearing others; `DataTable` cursor boundary (last page, empty page, error on page 2 keeps page 1); keyboard and `aria` roles for the tree and board; `screen:new` for a catalogue screen produces a file set that type-checks and passes its skeleton tests.
- [ ] **Step 2: Run** `npm test -w @machvon/web`; expected FAIL.
- [ ] **Step 3: Implement** the families over the prototype CSS (no new visual language); extract `UnitTree` and `PermissionMatrix` from M2d code rather than rewriting; the scaffold reads the catalogue, never copies it.
- [ ] **Step 4: Run** web tests, `i18n:check`, `routes:check`, one browser lane run of the kit demos against the baselines (record ratios), full lint; expected PASS.
- [ ] **Step 5: Commit** `feat(web): add the UI kit families and the screen scaffold`.

### Task K5: UAT-COVERAGE generator (ST-KERNEL-090)

**Files:**
- Create: `scripts/uat-coverage.mjs` and test, `UAT-COVERAGE.md` (generated, committed), `docs/uat/coverage-status.json` (statuses written by slices)
- Modify: root `package.json` (`uat:coverage`, `uat:coverage:check` in `lint`)

**Interfaces:**
- Produces: `buildCoverage(plan, catalog, status): Row[]` with `Row = { id: string; kind: 'screen' | 'function'; module: string; release: string; slice: string; written: 'NO' | 'YES'; ran: 'NO' | 'YES'; result: 'PENDING' | 'PASS' | 'FAIL'; evidence?: string }`; one row per catalogue screen (478) and per story operation group; status file keyed by row id; the check fails when a screen or function of the plan has no row or a row has no plan source.

- [ ] **Step 1: Write failing tests**: 478 screen rows plus function rows; stable ordering; a status entry for an unknown id is rejected; `uat:coverage:check` fails after the plan gains a screen; ADM-01 and ADM-03 rows read `written YES, ran YES` only when their e2e evidence file exists.
- [ ] **Step 2: Run** `node --test scripts/uat-coverage.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** the generator (pure functions plus a thin CLI), seed statuses for the two implemented screens.
- [ ] **Step 4: Run** the script tests and `npm run lint`; expected PASS.
- [ ] **Step 5: Commit** `feat: generate the UAT coverage matrix from the plan`.

### Task K6a: Import framework (ST-KERNEL-070) for MDM-006 and MDM-007

**Files:**
- Create: `packages/kernel/src/import-framework.ts`, `packages/db/src/import-store.ts`, tests, `apps/api/src/modules/kernel/imports.controller.ts`
- Modify: module descriptor of K1 for the kernel module

**Interfaces:**
- Produces: `ImportJob`, `planImport(file: ImportFile, schema: RowSchema, existing: ExistingIndex): ImportPlan` (pure: row-level errors with line, column, code; duplicates by natural key; no partial apply flag), `ImportStore.apply(tx, plan)` (atomic, idempotent by file SHA-256, quarantine table for rejected files, reconciliation counts), `ImportWizard` data contract used by K3.

- [ ] **Step 1: Write failing tests**: same file twice applies once; a file with one bad row applies nothing and reports the row; a 100,000-row file plans in bounded memory; hash mismatch quarantines; concurrent imports of different files for one tenant serialise on the natural-key lock.
- [ ] **Step 2: Run** the new tests; expected FAIL.
- [ ] **Step 3: Implement** the pure planner first, then the store on the M2b command pipeline (audit and outbox in the same transaction).
- [ ] **Step 4: Run** kernel and db tests, lint, typecheck; expected PASS.
- [ ] **Step 5: Commit** `feat(kernel): add the idempotent file import framework`.

### Task K8: Maker-checker and versioned records

**Files:**
- Create: `packages/kernel/src/four-eyes.ts`, `packages/db/src/versioned-record.ts`, tests

**Interfaces:**
- Produces: `assertFourEyes(maker: string, checker: string): void` (throws `SELF_APPROVAL_DENIED` 403); `ChangeRequest<T>` state machine (`Draft → Submitted → Approved | Rejected → Applied`, guarded transitions, impact preview callback); `supersede(tx, table, id, expectedVersion, next)` keeping history and effective dates.

- [ ] **Step 1: Write failing tests**: maker equal to checker is refused; illegal transitions refused with `STAGE_TRANSITION_DENIED`; supersede keeps the old row with `valid_until` and links the successor; concurrent supersede of one record commits once.
- [ ] **Step 2: Run** kernel and db tests; expected FAIL.
- [ ] **Step 3: Implement** pure state machine in kernel, persistence helper in db.
- [ ] **Step 4: Run** full gates; expected PASS.
- [ ] **Step 5: Commit** `feat(kernel): add maker-checker and versioned record helpers`.

After these kits, MDM-1 and ISS-1 are written as ordinary plans (stories listed in the slice table; operations, tables and screens from the plan JSON; screens by `screen:new`).

## Appendix: open R0 stories each slice depends on

- **MOB-1:** KERNEL-001, KERNEL-024, KERNEL-028
- **KERNEL-2:** KERNEL-002, KERNEL-004, KERNEL-014, KERNEL-015, KERNEL-040, KERNEL-041, KERNEL-050, KERNEL-051
- **MOB-2:** KERNEL-002, KERNEL-014, KERNEL-042, KERNEL-044
- **DOC-1:** DOC-001, DOC-002, DOC-003, DOC-005
- **IAM-1:** IAM-003
- **OMNI-1:** SAS-002
- **ADM-1:** ADM-003, ADM-006, KERNEL-044, NOT-001, SAS-001
- **MOB-4:** KERNEL-028
- **NOT-1:** IAM-003, NOT-001, SAS-002
- **SAS-2:** ADM-003, IAM-003, NOT-001, SAS-001, SAS-002, SAS-003, SAS-004

## Self-Review

- **Coverage:** every R1 story is in exactly one slice (203 of 203); R2, R3, R4 are covered at module level; the 42 open R0 stories are classified (track A 25, track B 17); screens: 476 not done, assigned by release (R1 270 web and 53 mobile, R2 107 and 16, R3 2 and 3).
- **Consistency:** kit IDs used in the slice table are defined in section 3; slice IDs in section 9 exist in section 4; the critical path of section 4 matches the slice graph; counts of this file are generated from the plan JSON and must be regenerated when it changes.
- **Open points:** chart library choice (K12), Flutter toolchain check, owner sign-off of the R1 minimum scope (document 09 R1 entry), confirmation of D9 calibration after the first slice.
