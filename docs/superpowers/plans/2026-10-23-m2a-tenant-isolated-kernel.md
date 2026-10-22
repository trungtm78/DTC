# M2a Tenant-Isolated Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first product code of MACHVON: a TypeScript monorepo whose kernel proves tenant isolation end to end (real PostgreSQL with FORCE RLS, tenant transaction context, signed worker context, Problem+JSON errors, contract-first checks) and whose CI blocks any change that breaks it.

**Architecture:** npm workspaces monorepo. `packages/kernel` holds framework-free tenant, error and key libraries; `packages/db` generates and applies migrations from the design SQL and verifies RLS against a real embedded PostgreSQL; `packages/contracts` lints `openapi.json` and generates TypeScript types and permission tables; `apps/api` is the NestJS shell that wires them. The design package under `Design/MACHVON_Design` stays the source of truth and is read, never copied by hand.

**Tech Stack:** Node 24, TypeScript (strict), NestJS, Jest with `@swc/jest`, `pg`, `embedded-postgres` for tests (PostgreSQL 18, no Docker), `dependency-cruiser`, ESLint with `typescript-eslint`, `openapi-typescript`.

**Spec:** `Design/MACHVON_Design/03_Engineering/implementation_plan.json` stories ST-KERNEL-010, ST-KERNEL-020, ST-KERNEL-021, ST-KERNEL-026 (isolation part), ST-KERNEL-030, ST-IAM-001; `Design/MACHVON_Design/01_Documents/04_Thiet_ke_co_ban.md`; `Design/MACHVON_Design/01_Documents/05_modules/IAM.md`; `AUTONOMOUS_EXECUTION_PROTOCOL.md`.

**Out of scope for M2a (later plans):** Keycloak and OIDC (ST-IAM-002), Redis server (only the key helper here), Dart client and Flutter (M2c), PowerSync (ST-KERNEL-002/-045), Temporal, audit and outbox tables logic (ST-ADM-001/-002), web shell (ST-KERNEL-111).

## Global Constraints

- Code, identifiers, commit messages and comments are English; user-facing text uses i18n keys `module.screen.action.state` with `vi` and `en` files (protocol rule).
- Every merge: lint, `tsc --noEmit`, all tests green, line coverage of changed code at least 90 percent, no `TODO`, `@ts-ignore`, empty `catch` (protocol scan in `ci/`).
- Tenant GUC name is exactly `app.tenant_id`; the RLS predicate is `tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid` (already generated in `schema_reference.sql`).
- Database roles: `machvon_owner` (owns objects, runs migrations), `machvon_app` (NOSUPERUSER NOBYPASSRLS, owns nothing, INSERT and SELECT only on `audit_entry`), `machvon_control`, `machvon_outbox_relay`, `machvon_reporting`, `machvon_sync`.
- Test database: PostgreSQL started by `embedded-postgres` with `--encoding=UTF8 --locale=C`; the `vector` extension is unavailable there, so the TEST profile replaces `CREATE EXTENSION IF NOT EXISTS vector;` and `vector(1024)` with nothing and `real[]`; production migrations keep pgvector.
- Error codes must exist in `Design/MACHVON_Design/03_Engineering/error_codes.json` (`registry`, 629 codes); canonical codes: `IDEMPOTENCY_CONFLICT`, `SELF_APPROVAL_DENIED`, `VERSION_CONFLICT`, `SCOPE_DENIED`, `FIELD_NOT_ALLOWED`, `TENANT_CONTEXT_INVALID`.
- Fixture tenants are `TNT-A` and `TNT-B` (`Design/MACHVON_Design/03_Engineering/test_fixtures.json`).
- No secrets in the repo; signing keys come from environment variables named in `.env.example`.
- Work in small commits using Conventional Commits; never push with force; the pre-push hook runs all gates.

## Review Focus

- A request that fails mid-transaction on a pooled connection must not leave `app.tenant_id` set for the next borrower (pool leak after rollback and after thrown error).
- A tenant id that is not a UUID (empty string, `'; drop table`, 40 characters) must give 400 `TENANT_CONTEXT_INVALID`, never a 500 cast error and never rows.
- Two concurrent requests for different tenants on a pool of one or two connections must each see only their own rows.
- Applying the generated migrations twice, or on a database that already holds V1, must fail loudly or no-op, never half apply.
- The error filter must not return stack traces, SQL text or constraint names to the client; Vietnamese characters (for example `Đà Nẵng`) must round-trip through the database unchanged.

---

### Task 1: Monorepo skeleton and merge gates (ST-KERNEL-010)

**Files:**
- Create: `package.json` (workspaces `apps/*`, `packages/*`), `tsconfig.base.json`, `eslint.config.mjs`, `jest.preset.cjs`, `.dependency-cruiser.cjs`, `.env.example`, `scripts/architecture-check.mjs`
- Create: `packages/kernel/{package.json,tsconfig.json,src/index.ts}`, `packages/db/{package.json,tsconfig.json,src/index.ts}`, `packages/contracts/{package.json,tsconfig.json,src/index.ts}`, `apps/api/{package.json,tsconfig.json,src/main.ts}`
- Modify: `ci/config.json` (add required stage `product-tests`), `ci/src/verify.mjs` and `ci/test/verify.test.mjs` (stage runs `npm test --workspaces --if-present` and `npm run lint`, `npm run architecture` when the root `package.json` exists), `.github/workflows/ci.yml`
- Test: `scripts/architecture-check.test.mjs`, `ci/test/verify.test.mjs`

**Interfaces:**
- Produces: workspace package names `@machvon/kernel`, `@machvon/db`, `@machvon/contracts`, `@machvon/api`; root scripts `lint`, `typecheck`, `test`, `architecture`; module rule: `apps/api` may import packages, packages must not import `apps/*`, `@machvon/kernel` imports nothing from the other packages.

- [ ] **Step 1: Write the failing test** `scripts/architecture-check.test.mjs`: create a temp copy of the repo layout with `packages/kernel/src/bad.ts` containing `import '@machvon/db'`; run `architectureCheck(root)` and assert it returns a violation naming `packages/kernel/src/bad.ts -> @machvon/db`; with the file removed it returns `[]`.
- [ ] **Step 2: Run** `node --test scripts/architecture-check.test.mjs`; expected FAIL (module missing).
- [ ] **Step 3: Implement** `architectureCheck(root: string): Promise<string[]>` in `scripts/architecture-check.mjs` using `dependency-cruiser` programmatically with the rules in Interfaces; scaffold the four packages with strict `tsconfig` (`strict`, `noUncheckedIndexedAccess`, `module` NodeNext) and one exported constant each so `tsc` passes; Jest preset uses `@swc/jest` with `coverageThreshold` global 90 for lines.
- [ ] **Step 4: Add the CI stage test** in `ci/test/verify.test.mjs`: with a fake root containing `package.json`, stage `product-tests` runs the three scripts and fails when one exits non-zero; without `package.json` it reports `skipped`. Implement in `ci/src/verify.mjs` with messages in `ci/src/messages/{vi,en}.json`.
- [ ] **Step 5: Run** `npm install && npm run lint && npm run typecheck && npm test && npm run architecture` and `cd ci && npm test`; expected all PASS, ci coverage at least 90 percent.
- [ ] **Step 6: Seed three failing changes on scratch branches and confirm each is blocked** (architecture edge, missing review label via the PR template check, `openapi.json` inconsistency via `work/tools` check); record the three CI run links in `PROGRESS.md`.
- [ ] **Step 7: Commit** `chore(repo): add workspaces, gates and architecture check`.

### Task 2: Real PostgreSQL test harness

**Files:**
- Create: `packages/db/src/test-database.ts`, `packages/db/src/test-profile.ts`
- Test: `packages/db/test/test-database.test.ts`, `packages/db/test/test-profile.test.ts`

**Interfaces:**
- Produces: `applyTestProfile(sql: string): string` (removes the vector extension line, replaces `vector(1024)` with `real[]`); `interface TestDatabase { adminUrl: string; urlFor(role: 'machvon_owner'|'machvon_app'|'machvon_control'|'machvon_outbox_relay'|'machvon_reporting'|'machvon_sync'): string; stop(): Promise<void> }`; `startTestDatabase(): Promise<TestDatabase>` (UTF8, C locale, random free port, temp directory under the OS temp dir, roles created with login and a random password, stopped in `finally` by callers).

- [ ] **Step 1: Write failing tests**: `applyTestProfile('CREATE EXTENSION IF NOT EXISTS vector;\nx vector(1024)')` contains neither `vector` token nor `real[]` missing (assert exact output `'\nx real[]'`); `startTestDatabase()` returns a database where `select 'Đà Nẵng' as v` over `urlFor('machvon_app')` round-trips exactly (Review Focus: UTF8) and `select rolbypassrls from pg_roles where rolname='machvon_app'` is `false`.
- [ ] **Step 2: Run** `npm test -w @machvon/db`; expected FAIL.
- [ ] **Step 3: Implement** both functions; `startTestDatabase` uses `embedded-postgres` with `initdbFlags: ['--encoding=UTF8','--locale=C']`, creates the six roles `LOGIN NOSUPERUSER NOBYPASSRLS`, and grants `CONNECT`; tests that start it use `beforeAll` with a 120 second timeout and `afterAll(stop)`.
- [ ] **Step 4: Run** `npm test -w @machvon/db`; expected PASS.
- [ ] **Step 5: Commit** `feat(db): add real PostgreSQL test harness with test profile`.

### Task 3: Migration generator and V1 apply (ST-KERNEL-020, part 1)

**Files:**
- Create: `packages/db/src/generate-migrations.ts`, `packages/db/src/migrate.ts`, `db/migrations/V001__roles_and_grants.sql`, `db/migrations/V002__schema.sql` (generated, committed), `packages/db/src/cli.ts` (`npm run db:generate`, `db:migrate`, `db:check`)
- Test: `packages/db/test/generate-migrations.test.ts`, `packages/db/test/migrate.test.ts`

**Interfaces:**
- Consumes: `startTestDatabase`, `applyTestProfile` (Task 2); `Design/MACHVON_Design/03_Engineering/schema_reference.sql` with the `_FK` and `_RLS` managed sections.
- Produces: `generateMigrations(schemaSql: string): { name: string; sql: string }[]` (deterministic, no hand edits, header comment with the SHA-256 of the source); `migrate(adminUrl: string, migrations: Migration[], opts?: { profile?: 'production'|'test' }): Promise<{ applied: string[] }>` recording applied versions with checksum in `machvon.schema_migration`; `checkGenerated(root): Promise<void>` throwing when committed files differ from regeneration.

- [ ] **Step 1: Write failing tests**: (a) `generateMigrations` on the real schema returns exactly two migrations, `V001__roles_and_grants` then `V002__schema`, and running it twice gives identical bytes; (b) on a fresh test database `migrate(...)` applies both as `machvon_owner` and the 291 tables exist; (c) running `migrate` a second time returns `{ applied: [] }`; (d) editing one byte of an applied migration makes `migrate` throw `MIGRATION_CHECKSUM_MISMATCH`.
- [ ] **Step 2: Run** `npm test -w @machvon/db -- generate-migrations migrate`; expected FAIL.
- [ ] **Step 3: Implement** `V001` as hand-written SQL owned by the generator template: create the six roles if missing (no password, passwords are set by deployment), `GRANT USAGE ON SCHEMA machvon`, default privileges so `machvon_app` receives SELECT, INSERT, UPDATE, DELETE on tables created by `machvon_owner`, then `REVOKE UPDATE, DELETE ON machvon.audit_entry FROM machvon_app`; `V002` is the design SQL verbatim. `migrate` wraps each migration in one transaction and takes an advisory lock.
- [ ] **Step 4: Run** the same command; expected PASS (allow up to 120 seconds).
- [ ] **Step 5: Commit** `feat(db): generate and apply V1 migrations from the design schema`.

### Task 4: RLS catalog and behaviour test (ST-KERNEL-020, part 2)

**Files:**
- Create: `packages/db/src/rls-report.ts`, `packages/db/src/index-report.ts`
- Test: `packages/db/test/rls-catalog.test.ts`

**Interfaces:**
- Consumes: `startTestDatabase`, `migrate`, `generateMigrations` (Tasks 2 and 3).
- Produces: `rlsReport(adminUrl: string): Promise<{ tenantTables: number; missing: { table: string; reason: 'no_rls'|'not_forced'|'no_restrictive'|'no_permissive' }[] }>`; `indexReport(adminUrl): Promise<{ missing: { table: string; column: string }[] }>` (every `*_id` column has an index starting with `tenant_id`).

- [ ] **Step 1: Write failing tests** against the migrated database: `rlsReport().missing` is `[]` and `tenantTables >= 283`; role attributes assert `machvon_app` is NOSUPERUSER, NOBYPASSRLS, owns 0 tables, has only INSERT and SELECT on `machvon.audit_entry`; behaviour: seed 3 `organization_unit` rows for TNT-A and 2 for TNT-B as owner, then as `machvon_app` without context `count(*)` is 0, with `set_config('app.tenant_id', <A>, true)` it is 3, and inserting a row with tenant B while context is A fails with SQLSTATE `42501` (WITH CHECK); a planted table without RLS in a scratch schema makes `rlsReport` list it (negative control).
- [ ] **Step 2: Run** `npm test -w @machvon/db -- rls-catalog`; expected FAIL.
- [ ] **Step 3: Implement** both reports from `pg_class`, `pg_policies`, `pg_index`; if `indexReport` lists missing indexes, decide per list: add them to the design SQL through `work/tools` (the SQL source of truth) rather than patching the migration, and record the change request in `baseline_change_register.json`.
- [ ] **Step 4: Run** the same command; expected PASS.
- [ ] **Step 5: Commit** `test(db): verify RLS catalog, roles and tenant behaviour on real PostgreSQL`.

### Task 5: Tenant transaction context (ST-KERNEL-021 and ST-IAM-001)

**Files:**
- Create: `packages/kernel/src/errors.ts`, `packages/kernel/src/tenant-context.ts`, `packages/db/src/tenant-database.ts`
- Test: `packages/kernel/test/tenant-context.test.ts`, `packages/db/test/tenant-database.test.ts`

**Interfaces:**
- Produces: `class DomainError extends Error { constructor(readonly code: string, readonly status: number, readonly detail?: string) }` in `errors.ts` (Task 7 reuses it); `interface TenantContext { tenantId: string; membershipId: string; scopeVersion: number }`; `parseTenantContext(input: unknown): TenantContext` throwing `DomainError('TENANT_CONTEXT_INVALID', 400)` for non-UUID values; `class TenantDatabase { constructor(pool: pg.Pool); withTenant<T>(ctx: TenantContext, work: (tx: TenantTx) => Promise<T>): Promise<T> }` where `TenantTx` exposes `query<R>(sql: string, params?: unknown[]): Promise<R[]>` and every call is inside `BEGIN`, `select set_config('app.tenant_id', $1, true)`, `COMMIT` or `ROLLBACK`.

- [ ] **Step 1: Write failing tests** (real database, pool of 1): after `withTenant(A, work)` throws, a plain `select current_setting('app.tenant_id', true)` on the same pooled connection returns empty (pool leak); two interleaved `withTenant` calls for A and B on a pool of 2 see only their own `organization_unit` rows; a repository query run through the pool outside `withTenant` returns 0 rows; `parseTenantContext({ tenantId: "'; drop table x;--" , ...})` throws code `TENANT_CONTEXT_INVALID`; empty string and 40-character strings also throw.
- [ ] **Step 2: Run** `npm test -w @machvon/kernel -w @machvon/db -- tenant`; expected FAIL.
- [ ] **Step 3: Implement** with `set_config(..., true)` (transaction-local) and parameterised queries only; connections are connected as `machvon_app`.
- [ ] **Step 4: Run** the same command; expected PASS.
- [ ] **Step 5: Commit** `feat(kernel): add tenant transaction context with pool-leak protection`.

### Task 6: Signed tenant context for workers (ST-IAM-001 acceptance 4)

**Files:**
- Create: `packages/kernel/src/signed-context.ts`
- Test: `packages/kernel/test/signed-context.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, `parseTenantContext` (Task 5).
- Produces: `signTenantContext(ctx: TenantContext, key: Buffer, now?: () => number, ttlSeconds?: number): string` (compact `base64url(payload).base64url(hmac-sha256)`, default TTL 300); `verifyTenantContext(token: string, key: Buffer, now?: () => number): TenantContext` throwing `TENANT_CONTEXT_INVALID` for bad shape, bad signature, expiry.

- [ ] **Step 1: Write failing tests**: round trip returns the same context; changing `tenantId` inside the payload while keeping the signature throws `TENANT_CONTEXT_INVALID`; an expired token throws; a token signed with another key throws; comparison uses `timingSafeEqual` (assert via a spy that no `===` on signatures is used is NOT required, assert behaviour only).
- [ ] **Step 2: Run** `npm test -w @machvon/kernel -- signed-context`; expected FAIL.
- [ ] **Step 3: Implement** with `node:crypto`.
- [ ] **Step 4: Run** same; expected PASS.
- [ ] **Step 5: Commit** `feat(kernel): sign and verify tenant context for background work`.

### Task 7: Problem+JSON errors, allowlist and error-code lint (ST-KERNEL-021)

**Files:**
- Create: `packages/kernel/src/allowlist.ts`, `packages/kernel/src/error-registry.ts`, `apps/api/src/problem.filter.ts`, `apps/api/src/allowlist.pipe.ts`, `scripts/lint-error-codes.mjs`
- Test: `packages/kernel/test/allowlist.test.ts`, `apps/api/test/problem.filter.test.ts`, `scripts/lint-error-codes.test.mjs`

**Interfaces:**
- Consumes: `DomainError` from Task 5.
- Produces: `loadErrorRegistry(path: string): Map<string, { status: number; title: string }>`; `assertAllowedFields<T extends object>(body: unknown, allowed: readonly (keyof T & string)[]): void` throwing `DomainError('FIELD_NOT_ALLOWED', 400, <comma separated names>)`; `ProblemFilter` (Nest `ExceptionFilter`) returning `application/problem+json` with `type`, `title` (i18n key `error.<code>.title`), `status`, `code`, `correlationId`; `lint-error-codes.mjs` scans `packages/**/src` and `apps/**/src` for `new DomainError('CODE'` and fails listing codes missing from the registry.

- [ ] **Step 1: Write failing tests**: PATCH body `{ name, status, tenant_id, role }` against allowed `['name']` yields 400 `FIELD_NOT_ALLOWED` naming `status, tenant_id, role`; the filter turns an unknown thrown `Error('select * from secret')` into 500 `INTERNAL_ERROR` without message, stack, SQL text or constraint names (Review Focus); the lint fails on `new DomainError('NOT_A_CODE', 400)` and passes on `new DomainError('SCOPE_DENIED', 403)`.
- [ ] **Step 2: Run** the four test files; expected FAIL.
- [ ] **Step 3: Implement** the units; every thrown code in M2a source must be in the registry (use `TENANT_CONTEXT_INVALID`, `FIELD_NOT_ALLOWED`, `SCOPE_DENIED`, `VERSION_CONFLICT`); add `INTERNAL_ERROR` to the registry through `work/tools` if absent.
- [ ] **Step 4: Run** same plus `node scripts/lint-error-codes.mjs`; expected PASS.
- [ ] **Step 5: Commit** `feat(kernel): add Problem JSON errors, field allowlist and error code lint`.

### Task 8: Contract lint and generation (ST-KERNEL-030, TypeScript part)

**Files:**
- Create: `packages/contracts/src/lint-openapi.ts`, `packages/contracts/src/generate.ts`, `packages/contracts/src/permissions.generated.ts` (generated, committed), `packages/contracts/src/types.generated.ts` (generated, committed)
- Test: `packages/contracts/test/lint-openapi.test.ts`, `packages/contracts/test/generate.test.ts`

**Interfaces:**
- Produces: `lintOpenApi(doc: OpenApiDocument): { operationId: string; rule: 'missing_x_permission'|'dto_exposes_secret' }[]`; `generatePermissions(doc): Record<string, string>` mapping `operationId` to `x-permission`; `generateTypes(doc): Promise<string>` using `openapi-typescript`; npm scripts `contracts:generate` and `contracts:check` (fails when committed output differs).

- [ ] **Step 1: Write failing tests**: a document with one operation lacking `x-permission` is reported with its `operationId`, and passes once added; a response schema named in `x-exposure: dto` containing `push_secret_ref` or `token_fingerprint` is reported as `dto_exposes_secret`; on the real `Design/MACHVON_Design/03_Engineering/openapi.json` (815 operations) lint returns `[]` and `generatePermissions` has 815 keys.
- [ ] **Step 2: Run** `npm test -w @machvon/contracts`; expected FAIL.
- [ ] **Step 3: Implement**; breaking-change detection for N versus N-1 is NOT in this task (add as ST-KERNEL-030 follow-up in `PROGRESS.md`).
- [ ] **Step 4: Run** same plus `npm run contracts:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(contracts): lint openapi and generate permission table and types`.

### Task 9: Tenant-prefixed keys (ST-IAM-001 acceptance 3)

**Files:**
- Create: `packages/kernel/src/tenant-keys.ts`
- Test: `packages/kernel/test/tenant-keys.test.ts`

**Interfaces:**
- Consumes: `parseTenantContext` (Task 5).
- Produces: `tenantKey(tenantId: string, ...parts: string[]): string` returning `t:{tenantId}:{parts.join(':')}` and rejecting empty parts or parts containing `*`; `interface KeyValueStore { get(key: string): Promise<string|null>; set(key: string, value: string, ttlSeconds?: number): Promise<void> }`; `class TenantCache { constructor(store: KeyValueStore); get(ctx: TenantContext, name: string): Promise<string|null>; set(ctx, name, value, ttlSeconds?): Promise<void> }`; ESLint rule in `eslint.config.mjs` forbidding calls to `.get(`/`.set(` on a `KeyValueStore` outside `packages/kernel/src/tenant-keys.ts`.

- [ ] **Step 1: Write failing tests** with an in-memory `KeyValueStore`: tenants A and B cache the same `name` and read back their own values; every stored key starts with `t:<their tenant id>:`; `tenantKey('a','x*')` throws.
- [ ] **Step 2: Run** `npm test -w @machvon/kernel -- tenant-keys`; expected FAIL.
- [ ] **Step 3: Implement** and add the lint rule with a test fixture that fails.
- [ ] **Step 4: Run** `npm test -w @machvon/kernel && npm run lint`; expected PASS.
- [ ] **Step 5: Commit** `feat(kernel): add tenant-prefixed cache keys`.

### Task 10: API shell and isolation conformance suite (ST-KERNEL-026, API and database channels)

**Files:**
- Create: `apps/api/src/app.module.ts`, `apps/api/src/organization-units.controller.ts` (read-only `GET /org-units/:id` and `GET /org-units` backed by `TenantDatabase`), `apps/api/test/isolation/{suite.ts,channels/api.ts,channels/database.ts,endpoint-enumerator.ts}`
- Test: `apps/api/test/isolation/isolation.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 9; operation `getOrganizationUnit` and its list operation in `openapi.json` (look up exact `operationId` values with `endpoint-enumerator.ts`).
- Produces: `interface IsolationChannel { name: string; seed(tenant: 'TNT-A'|'TNT-B'): Promise<void>; readAs(user: 'TNT-A', target: 'TNT-B'): Promise<{ status: number; body: string }> }` so later plans add search, file, export and sync channels; `enumerateIdBearingOperations(doc, implemented: Set<string>): string[]` returning implemented operations with path parameters; the suite fails when an implemented id-bearing operation has no registered foreign-id case.

- [ ] **Step 1: Write failing tests**: user of TNT-A requests the TNT-B org unit by id: status 404 `RESOURCE_NOT_FOUND`, body contains no TNT-B names or counts; the list returns only TNT-A rows; a controller registered without a case makes `enumerateIdBearingOperations` plus the suite fail; planting a query without tenant context in a test controller (negative control) makes the suite fail.
- [ ] **Step 2: Run** `npm test -w @machvon/api -- isolation`; expected FAIL.
- [ ] **Step 3: Implement** the controller using `TenantDatabase.withTenant`, a `TestAuthGuard` class, registered only by the test module, that builds `TenantContext` from a header signed with `signTenantContext` (real authentication arrives with ST-IAM-002), and the suite using the fixtures from `test_fixtures.json`.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture` from the root; expected all PASS with coverage at least 90 percent.
- [ ] **Step 5: Update** `PROGRESS.md` (Milestone M2, task list, test status), `implementation_readiness.json` `implementation` to `IN_PROGRESS`, and push; the pre-push hook runs every gate.
- [ ] **Step 6: Commit** `feat(api): add tenant isolation conformance suite for API and database`.

## Self-Review

- **Spec coverage:** KERNEL-010 acceptance 1 to 3 map to Tasks 1 (architecture edge, labels via PR template and CI stage, consistency tool stage); KERNEL-020 acceptance 1 and 2 to Tasks 3 and 4, acceptance 3 (upgrade with zero data loss) is covered by the second-apply test and extended when V003 exists; KERNEL-021 to Tasks 5 and 7; IAM-001 acceptance 1 to 4 to Tasks 5, 6, 9, 10; KERNEL-026 acceptance 1 and 3 to Task 10 (acceptance 2, scope cases, needs ADM roles, later plan); KERNEL-030 acceptance 1 and 3 to Task 8 (acceptance 2 Dart contract test is M2c).
- **Type consistency:** `DomainError` and `TenantContext` are defined once in Task 5 and consumed unchanged by Tasks 6, 7, 9 and 10.
- **Review Focus:** each line has a test in Tasks 5 (pool leak, invalid id, concurrency), 3 (double apply), 7 (error leakage), 2 (UTF8 round trip).
