# M2b Command Pipeline and Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every write command in MACHVON runs through one pipeline that is idempotent, optimistically locked, audited in its own transaction and publishes events exactly once downstream, and the audit trail is tamper-evident.

**Architecture:** Framework-free primitives (canonical hashing, `If-Match`, Merkle seals, backoff) live in `packages/kernel`; the stores that need PostgreSQL (idempotency, outbox and relay, consumer inbox, audit writer, sealer and verifier) live in `packages/db` on top of `TenantDatabase`; `apps/api` adds one Nest interceptor that opens the tenant transaction and wires them. A hand-written migration V003 adds the append-only triggers and the relay grants that the generated V001/V002 do not contain.

**Tech Stack:** Same as M2a (Node 24, TypeScript strict, NestJS 11, Jest with `@swc/jest`, `pg`, `embedded-postgres` PostgreSQL 18).

**Spec:** `Design/MACHVON_Design/03_Engineering/implementation_plan.json` stories ST-ADM-001, ST-ADM-002, ST-KERNEL-023, ST-KERNEL-028 (generator and gate parts); rules BR-PLT-01 and BR-PLT-02 in `Design/MACHVON_Design/01_Documents/05_modules/ADM.md`; tables `idempotency_record`, `outbox_event`, `integration_event_inbox`, `audit_event`, `audit_seal` in `03_Engineering/schema_reference.sql` (section "Platform services"); `AUTONOMOUS_EXECUTION_PROTOCOL.md`.

**Out of scope for M2b (later plans, logged in PROGRESS.md):** scheduling of the jobs (Temporal schedules, ST-KERNEL-044) and alert routing (ST-KERNEL-051): M2b ships callable jobs, a `MetricsSink` and an `AlertSink` port; the PDP (ST-IAM-004) and real authentication (ST-IAM-002): a 403 `DomainError` stands in for a PDP denial; the read endpoints `get_resources_audit_event*` and `get_resources_outbox_event*` (they need the PDP and the web shell); the TK-4 run of the generated conformance suite against 10 commands of different modules (only 3 sample commands exist until the M3 slices; the generator and the CI gate are done here).

## Global Constraints

- All M2a constraints still apply (English code, i18n keys for user text, 90 percent patch coverage, strict TypeScript, no `TODO`/`@ts-ignore`/empty `catch`, Conventional Commits, no force push, pre-push gates).
- Idempotency (BR-PLT-02): every POST/PUT/PATCH/DELETE needs `Idempotency-Key` of 16 to 128 characters; unique `(tenant_id, subject_id, operation, key_hash)`; `key_hash = sha256(key)`; `request_hash = sha256(canonical JSON body + path params + If-Match)`; first request inserts `IN_PROGRESS` with `locked_until = now + 30 s`; same key and hash returns the stored response with header `Idempotency-Replayed: true`; other hash gives 409 `IDEMPOTENCY_CONFLICT`; still running gives 409 `IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 2`; a 5xx leaves `FAILED_RETRYABLE` and the same key may be retried; TTL 72 hours for every command and 7 days for money and offline-mobile commands (`CHECK expires_at <= created_at + 7 days`).
- `If-Match` carries the integer `version` (`"7"`, `W/"7"` or `7`); missing header gives 428 `PRECONDITION_REQUIRED`; stale value gives 409 `VERSION_CONFLICT` with `current_version`; a missing or malformed `Idempotency-Key` gives 400 `INVALID_REQUEST`.
- Outbox: `event_key` unique per tenant; relay claims `FOR UPDATE SKIP LOCKED` in batches of 100; exponential backoff `min(600, 2^(attempt-1))` seconds; status `DEAD` after 20 attempts; alert when the oldest `PENDING` event is older than 300 seconds.
- Audit (BR-PLT-01): the success row is written in the command transaction; a denied command is written in a separate transaction with `outcome = 'DENIED'`; the application role has `INSERT` and `SELECT` only on `audit_event` and `audit_seal`; a trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` for every role except `machvon_owner`; `seal_hash = sha256(prev_seal_hash || merkle_root || to_seq)`.
- Error codes used must exist in `error_codes.json`: `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`, `VERSION_CONFLICT`, `PRECONDITION_REQUIRED`, `INVALID_REQUEST`, `INTERNAL_ERROR`; the lint `scripts/lint-error-codes.mjs` must stay green.

## Decisions taken without asking (also written to PROGRESS.md)

| Point | Decision | Basis |
|---|---|---|
| Idempotency record and the business transaction | `begin` commits `IN_PROGRESS` in its own transaction; `complete` is written inside the business transaction, so effects and the stored response commit together; a rollback marks the record `FAILED_RETRYABLE` (5xx) or `COMPLETED` with the problem body (4xx) in a separate transaction | BR-PLT-02 plus AC-ST-KERNEL-028-3 |
| Crashed process leaves `IN_PROGRESS` | `begin` takes the record over once `locked_until` has passed or `expires_at` has passed | BR-PLT-02 lock of 30 s |
| Consumer inbox table | reuse `integration_event_inbox` with `provider = 'consumer:<name>'`, `event_key = <outbox event id>`, `signature_key_id = 'internal'`; no new table | schema has no internal inbox; baseline preservation |
| Audit sequence gaps | `audit_event_seq` is global and commits out of order, so writers take `pg_advisory_xact_lock_shared` on `audit:<tenant>` before `nextval` and the sealer takes the exclusive lock; a sealed window can never receive a late lower `seq` | correctness of Merkle windows |
| Row localisation of a tamper | the verifier reports the seal window (`from_seq`, `to_seq`) that fails, not the single row, because the design stores no per-row hash | AC-ST-KERNEL-023-2 satisfied at window granularity; exact row needs a change request on `audit_event` |
| Worker identity in consumers | consumers run with `membershipId = 00000000-0000-4000-8000-000000000000` and `scopeVersion = 0` | ST-KERNEL-022 pattern, no user behind an event |

## Review Focus

- Twenty parallel requests with one key and one body: exactly one handler execution, the rest replay or 409 `IDEMPOTENCY_IN_PROGRESS`, never two effects.
- Handler throws after `begin`: record ends `FAILED_RETRYABLE`, the retry with the same key runs normally and the audit and outbox rows of the failed attempt do not exist.
- Process dies with `IN_PROGRESS` and the 30 s lock expired: the next request with the same key and body is executed, with a different body it is a 409 conflict.
- A request body with Vietnamese text, reordered keys, numbers like `1e3` vs `1000`, or `null` fields hashes consistently (key order never changes the hash, a different value always does).
- Audit `safe_diff` of a command that touches `password`, `token`, `authorization` or a caller-declared sensitive field never contains the raw value; an audit insert with an invalid `outcome` is rejected by the database.
- A row inserted into an already sealed window by the owner, a deleted row, a reordered `prev_seal_hash` and a row appended between two seals are each reported by `verifyAuditSeals`.

---

### Task 1: Migration V003, append-only triggers and relay grants (ST-ADM-002 TK-1, ST-KERNEL-023 TK-1)

**Files:**
- Create: `db/migrations/V003__platform_services.sql`, `packages/db/src/migrated-test-database.ts`
- Modify: `apps/api/test/isolation/test-app.ts` (`startIsolationDatabase` delegates to `startMigratedTestDatabase`)
- Test: `packages/db/test/platform-services-migration.test.ts`

**Interfaces:**
- Produces: `startMigratedTestDatabase(root: string): Promise<TestDatabase>` (embedded PostgreSQL with every committed migration applied through `loadCommittedMigrations`, profile `test`); SQL function `machvon.reject_audit_mutation()` and triggers `audit_event_append_only` and `audit_seal_append_only` (`BEFORE UPDATE OR DELETE OR TRUNCATE`, raise `42501` unless `current_user = 'machvon_owner'`); `GRANT SELECT, UPDATE ON machvon.outbox_event TO machvon_outbox_relay`.
- `checkGenerated` keeps checking only V001 and V002; V003 and later are authored by hand and never touched by `db:generate`.

- [ ] **Step 1: Write the failing tests** in `platform-services-migration.test.ts` against `startMigratedTestDatabase`: as `machvon_app` inside a tenant transaction, `UPDATE audit_event` and `DELETE FROM audit_event` and `TRUNCATE audit_event` each fail with code `42501` (also for `audit_seal`); `INSERT` and `SELECT` succeed; as `machvon_owner` an `UPDATE audit_event SET action = 'x'` succeeds (the tamper drill needs it); `machvon_outbox_relay` can `SELECT` and `UPDATE outbox_event` across tenants (policy `outbox_relay_access`) but gets `permission denied` on `INSERT` and on `organization_unit`; applying all migrations a second time applies nothing; editing V003 after it ran throws `MigrationChecksumError`.
- [ ] **Step 2: Run** `npm test -w @machvon/db -- platform-services` ; expected FAIL.
- [ ] **Step 3: Write V003** (header comment, `SET LOCAL` not needed: it runs as owner): the trigger function with `SECURITY INVOKER`, both triggers (statement level for `TRUNCATE`, row level for `UPDATE OR DELETE`), the relay grant, and `REVOKE TRUNCATE` on both tables from `machvon_app` if still granted. Implement `startMigratedTestDatabase` by reusing `startTestDatabase`, `loadCommittedMigrations`, `migrate(..., { profile: 'test' })`; stop the database when migration fails (same pattern as the current `startIsolationDatabase`).
- [ ] **Step 4: Run** `npm test -w @machvon/db && npm test -w @machvon/api -- isolation && npm run db:check`; expected PASS (isolation suite unchanged in behaviour).
- [ ] **Step 5: Commit** `feat(db): add append-only audit triggers and outbox relay grants`.

### Task 2: Kernel primitives for idempotency, versions, seals and backoff (ST-ADM-001 TK-2/3, ST-ADM-002 TK-3)

**Files:**
- Create: `packages/kernel/src/canonical-json.ts`, `idempotency.ts`, `if-match.ts`, `audit-seal.ts`, `outbox-policy.ts`, `redact.ts`, `ports.ts`
- Modify: `packages/kernel/src/errors.ts` (optional `extensions` and `headers` on `DomainError`), `packages/kernel/src/index.ts` (exports)
- Test: `packages/kernel/test/{canonical-json,idempotency,if-match,audit-seal,outbox-policy,redact}.test.ts`

**Interfaces (all exported from `@machvon/kernel`):**
- `canonicalJson(value: unknown): string`: sorted keys at every depth, no whitespace, `undefined` object members dropped, array order kept, throws `TypeError` for `NaN`, `Infinity`, functions, symbols, bigint, cycles; `sha256Hex(text: string): string`.
- `keyHashOf(key: string): string`; `parseIdempotencyKey(header: string | string[] | undefined): string` (throws `DomainError('INVALID_REQUEST', 400, 'idempotency_key')` when absent, repeated, shorter than 16, longer than 128 or not visible ASCII); `requestHashOf(parts: { body: unknown; pathParams: Record<string, string>; ifMatch: string | null }): string`; `IDEMPOTENCY_LOCK_SECONDS = 30`; `type IdempotencyTtl = 'standard' | 'extended'` with `IDEMPOTENCY_TTL_HOURS = { standard: 72, extended: 168 }`.
- `parseIfMatch(header: string | string[] | undefined): number` (428 `PRECONDITION_REQUIRED` when absent; 400 `INVALID_REQUEST` when not a non-negative safe integer after stripping `W/` and quotes); `formatEtag(version: number): string` giving `"7"`; `versionConflict(currentVersion: number, safeDiff?: Record<string, unknown>): DomainError` (409 `VERSION_CONFLICT`, `extensions: { current_version, safe_diff? }`).
- `auditLeafHash(canonicalRow: string): string` = sha256 of `0x00` byte then the text; `merkleRoot(leafHashes: string[]): string` (RFC 6962 shape: node = sha256(`0x01` + left + right); an odd last node is promoted unchanged; one leaf gives the leaf; empty input throws); `sealHashOf(prevSealHash: string | null, root: string, toSeq: number): string` = sha256 of `${prev ?? ''}${root}${toSeq}`.
- `outboxDelaySeconds(attempt: number): number` = `Math.min(600, 2 ** (attempt - 1))`; `OUTBOX_BATCH_SIZE = 100`; `OUTBOX_MAX_ATTEMPTS = 20`; `OUTBOX_LAG_ALERT_SECONDS = 300`.
- `safeDiff(diff: Record<string, unknown>, options?: { sensitiveKeys?: readonly string[] }): Record<string, unknown>`: deep copy where any key matching `/pass(word)?|secret|token|authorization|api[_-]?key|private[_-]?key/i` or listed in `sensitiveKeys` has the value `'[REDACTED]'`, at every depth including inside arrays.
- `interface MetricsSink { increment(name: string, labels?: Record<string, string>): void; gauge(name: string, value: number, labels?: Record<string, string>): void }`, `interface AlertSink { raise(code: string, context: Record<string, unknown>): void }`, `NOOP_METRICS`, `NOOP_ALERTS`.

- [ ] **Step 1: Write failing tests** (names and key assertions):
  - `canonical-json`: `canonicalJson({b:1,a:{d:2,c:[3,{z:1,y:2}]}}) === '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}'`; `{a:undefined,b:1}` equals `{b:1}`; `1e3` and `1000` give the same text; `'Đà Nẵng'` round trips; each throwing input throws `TypeError`.
  - `idempotency`: 15 and 129 characters rejected, 16 and 128 accepted, a space or non-ASCII rejected, array header rejected; `requestHashOf` is equal for reordered keys, differs when `ifMatch` differs (`null` vs `'7'`), differs when a path param differs.
  - `if-match`: `'"7"'`, `'W/"7"'`, `'7'` parse to `7`; `undefined` throws status 428 code `PRECONDITION_REQUIRED`; `'abc'`, `'-1'`, `'7.5'`, `'9007199254740993'` throw 400; `versionConflict(8)` has `extensions.current_version === 8`.
  - `audit-seal`: `merkleRoot` of 1, 2, 3, 4, 5 leaves matches hand-computed digests for 1 to 3; changing any leaf or swapping two leaves changes the root; a promoted odd node is not duplicated (three leaves differ from `[a,b,c,c]`); `sealHashOf(null, r, 5)` equals sha256 of `r5`.
  - `outbox-policy`: delays for attempts 1, 2, 10, 11, 20 are 1, 2, 512, 600, 600; attempt 0 and non-integers throw `RangeError`.
  - `redact`: nested, array and `sensitiveKeys` cases, input object not mutated, non-sensitive Vietnamese strings unchanged.
- [ ] **Step 2: Run** `npm test -w @machvon/kernel`; expected FAIL.
- [ ] **Step 3: Implement** the modules with the signatures above; `DomainError` keeps its three positional arguments and gains a fourth optional `{ extensions?: Record<string, unknown>; headers?: Record<string, string> }`.
- [ ] **Step 4: Run** `npm test -w @machvon/kernel && npm run lint && npm run typecheck`; expected PASS with at least 90 percent coverage.
- [ ] **Step 5: Commit** `feat(kernel): add idempotency, version, seal and outbox primitives`.

### Task 3: Idempotency store (ST-ADM-001 TK-1/2, ST-KERNEL-028 TK-2 part)

**Files:**
- Create: `packages/db/src/idempotency-store.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/idempotency-store.test.ts`

**Interfaces:**
- Consumes: Task 1 `startMigratedTestDatabase`; Task 2 `IdempotencyTtl`, `IDEMPOTENCY_TTL_HOURS`, `IDEMPOTENCY_LOCK_SECONDS`; `TenantDatabase`, `TenantTx`.
- Produces:
  ```ts
  type StoredResponse = { kind: 'success'; body: unknown } | { kind: 'problem'; code: string; status: number; detail?: string; extensions?: Record<string, unknown> };
  type BeginResult =
    | { kind: 'started'; recordId: string }
    | { kind: 'replay'; httpStatus: number; response: StoredResponse }
    | { kind: 'conflict' }
    | { kind: 'in_progress'; retryAfterSeconds: 2 };
  class IdempotencyStore {
    constructor(database: TenantDatabase);
    begin(ctx: TenantContext, input: { operation: string; keyHash: string; requestHash: string; ttl: IdempotencyTtl }): Promise<BeginResult>;
    completeInTx(tx: TenantTx, recordId: string, outcome: { httpStatus: number; response: StoredResponse; resourceType?: string; resourceId?: string }): Promise<void>;
    finishOutsideTx(ctx: TenantContext, recordId: string, outcome: { retryable: true } | { retryable: false; httpStatus: number; response: StoredResponse }): Promise<void>;
    purgeExpired(ctx: TenantContext): Promise<number>;
  }
  ```
  The subject is `ctx.membershipId`. Expiry is computed in SQL (`now() + make_interval(hours => $n)`) so the table CHECK never sees client clock skew.

- [ ] **Step 1: Write failing tests** (real PostgreSQL, two tenants): first `begin` gives `started`, row is `IN_PROGRESS` with `locked_until` about 30 s ahead; second `begin` same hash while locked gives `in_progress`; after `completeInTx` the same `begin` gives `replay` with the stored status and body; another `requestHash` gives `conflict` (also while `IN_PROGRESS`); `finishOutsideTx` retryable then `begin` gives `started` again with the same `recordId`; a row whose `locked_until` is moved into the past by the owner is taken over (`started`), with another hash after takeover it is `conflict`; a row past `expires_at` is startable; the same key for another membership or another tenant is independent (different tenant never sees the row); `ttl: 'extended'` stores `expires_at - created_at` of 7 days and `'standard'` of 72 hours (both within the table CHECK); 20 parallel `begin` calls with one key give exactly one `started` and nineteen `in_progress` or `replay`; `purgeExpired` deletes only expired rows of the tenant and returns the count; `completeInTx` inside a transaction that then throws leaves the row `IN_PROGRESS` (rolled back).
- [ ] **Step 2: Run** `npm test -w @machvon/db -- idempotency-store`; expected FAIL.
- [ ] **Step 3: Implement** `begin` as one tenant transaction: `INSERT ... ON CONFLICT (tenant_id, subject_id, operation, key_hash) DO NOTHING RETURNING id`; on no row `SELECT ... FOR UPDATE` and branch on request hash, status, `locked_until`, `expires_at` as described in the Global Constraints; the initial `response_ref` is `'{}'::jsonb`.
- [ ] **Step 4: Run** `npm test -w @machvon/db && npm run lint && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit** `feat(db): add transactional idempotency store`.

### Task 4: Transactional outbox, relay and consumer inbox (ST-ADM-001 TK-1/4/5)

**Files:**
- Create: `packages/db/src/outbox.ts`, `packages/db/src/outbox-relay.ts`, `packages/db/src/consumer-inbox.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/{outbox,outbox-relay,consumer-inbox}.test.ts`, `packages/db/test/delivery-recovery.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2 (`outboxDelaySeconds`, `OUTBOX_*`, `MetricsSink`, `AlertSink`), `TenantDatabase`.
- Produces:
  ```ts
  interface OutboxEventInput { aggregateType: string; aggregateId: string; aggregateVersion: number; type: string; schemaVersion: number; payload: Record<string, unknown>; eventKey: string; correlationId: string; causationId?: string }
  function enqueueOutbox(tx: TenantTx, event: OutboxEventInput): Promise<{ id: string; duplicate: boolean }>;
  interface OutboxDelivery { id: string; tenantId: string; type: string; schemaVersion: number; aggregateType: string; aggregateId: string; aggregateVersion: number; payload: Record<string, unknown>; eventKey: string; correlationId: string; attempts: number }
  class OutboxRelay {
    constructor(pool: Pool, publish: (delivery: OutboxDelivery) => Promise<void>, options?: { metrics?: MetricsSink; alerts?: AlertSink; batchSize?: number });
    runOnce(): Promise<{ published: number; retried: number; dead: number }>;
    oldestPendingSeconds(): Promise<number>;
  }
  const WORKER_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000000';
  function consumeOnce(database: TenantDatabase, delivery: Pick<OutboxDelivery, 'id' | 'tenantId'>, consumer: string, work: (tx: TenantTx) => Promise<void>): Promise<'processed' | 'duplicate'>;
  ```
  `pool` connects as `machvon_outbox_relay`. `enqueueOutbox` takes the tenant from `current_setting('app.tenant_id')`, `ON CONFLICT (tenant_id, event_key) DO NOTHING`, and reports `duplicate: true` when the key existed. `runOnce` claims `status = 'PENDING' AND next_attempt_at <= now()` ordered by `next_attempt_at, created_at` with `FOR UPDATE SKIP LOCKED`, publishes inside the claiming transaction, marks `PUBLISHED` or schedules the retry; `last_error` stores the error class name only, never its message. It increments `outbox_published_total`, `outbox_retried_total`, `outbox_dead_total` and sets gauge `outbox_oldest_pending_seconds`; when that gauge exceeds `OUTBOX_LAG_ALERT_SECONDS` it raises `OUTBOX_LAG` once per run.

- [ ] **Step 1: Write failing tests**:
  - `outbox`: enqueue twice with one `eventKey` gives one row, second call `duplicate: true`; enqueue inside a rolled-back transaction leaves no row; tenant A's event is invisible to a tenant B transaction.
  - `outbox-relay`: 250 pending events are delivered in batches of 100 over three runs, none twice, ordered by creation; two relays running concurrently never claim the same row (publish counted per id); a failing publisher gives `attempts = 1`, `status = 'PENDING'`, `next_attempt_at` about 1 s ahead and `last_error` equal to the error class name; with `attempts = 19` one more failure gives `DEAD`; `oldestPendingSeconds` and the `OUTBOX_LAG` alert fire for an event aged 301 s (set by the owner) and not for 299 s; the relay role cannot insert (permission denied).
  - `consumer-inbox`: the same delivery id consumed twice runs `work` once and returns `processed` then `duplicate`; two different consumers each process the same event once; when `work` throws, no inbox row remains and the next call processes it; the work runs under the delivery's tenant (a query for another tenant's rows inside `work` sees none).
  - `delivery-recovery` (UAT-NFR-OPERABILITY-05): 100 events are enqueued by 100 commands; the relay's backend is terminated with `pg_terminate_backend` from inside the publisher at the 37th publish (relay run rejects, its transaction rolls back); the consumer's backend is terminated at its 61st work call; runs repeat, with the owner resetting `next_attempt_at` of retried rows, until none is `PENDING`; assert the downstream effect table (created by the test through `adminUrl`, columns `tenant_id`, `event_id` unique) holds exactly 100 distinct `event_id` values, no `DEAD` rows.
- [ ] **Step 2: Run** `npm test -w @machvon/db -- outbox consumer-inbox delivery-recovery`; expected FAIL.
- [ ] **Step 3: Implement** the three modules per the Interfaces; the relay catches only publisher errors (a lost connection must propagate).
- [ ] **Step 4: Run** `npm test -w @machvon/db && npm run lint && npm run typecheck && npm run architecture`; expected PASS.
- [ ] **Step 5: Commit** `feat(db): add transactional outbox, relay and consumer inbox`.

### Task 5: Audit writer, sealer and verifier (ST-ADM-002 TK-2/3/4/5, ST-KERNEL-023 TK-1/2/3)

**Files:**
- Create: `packages/db/src/audit-writer.ts`, `packages/db/src/audit-seal-job.ts`, `docs/runbooks/audit-tamper-drill.md`, `docs/runbooks/outbox-relay-lag.md`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/{audit-writer,audit-seal-job,audit-tamper}.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2 (`safeDiff`, `auditLeafHash`, `merkleRoot`, `sealHashOf`, `canonicalJson`, `AlertSink`, `MetricsSink`), `TenantDatabase`.
- Produces:
  ```ts
  type AuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILED';
  type AuditClassification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'PERSONAL';
  interface AuditEntry { action: string; resourceType: string; resourceId: string; diff: Record<string, unknown>; sensitiveKeys?: readonly string[]; reason?: string; correlationId: string; requestId: string; classification?: AuditClassification; impersonatorId?: string; onBehalfOfId?: string; ipHash?: string }
  const NIL_RESOURCE_ID = '00000000-0000-4000-8000-000000000000';
  class AuditWriter {
    constructor(database: TenantDatabase);
    recordInTx(tx: TenantTx, actorId: string, entry: AuditEntry): Promise<string>;           // outcome SUCCESS, returns the audit id
    recordDenied(ctx: TenantContext, entry: AuditEntry): Promise<string>;                    // separate transaction, outcome DENIED
  }
  interface SealOutcome { sealed: number; seals: number }
  interface VerifyOutcome { ok: true; seals: number } | { ok: false; seals: number; brokenAt: { sealId: string; fromSeq: number; toSeq: number; reason: 'ROOT_MISMATCH' | 'SEAL_HASH_MISMATCH' | 'CHAIN_LINK_MISMATCH' | 'UNSEALED_ROW_IN_GAP' } }
  class AuditSealJob {
    constructor(database: TenantDatabase, options?: { windowRows?: number; metrics?: MetricsSink; alerts?: AlertSink });  // windowRows default 1000
    seal(ctx: TenantContext): Promise<SealOutcome>;
    verify(ctx: TenantContext): Promise<VerifyOutcome>;   // raises AlertSink 'AUDIT_CHAIN_BROKEN' and counts audit_seal_failures_total on failure
  }
  ```
  Leaf text is `canonicalJson` of `{ id, seq, actor_id, action, resource_type, resource_id, safe_diff, reason, correlation_id, request_id, outcome, classification, impersonator_id, on_behalf_of_id, ip_hash, schema_version, occurred_at }` where `occurred_at` is selected as `to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` in the same SQL for sealing and verifying (microsecond precision survives). `recordInTx` first runs `select pg_advisory_xact_lock_shared(hashtextextended('audit:' || current_setting('app.tenant_id'), 0))`; `seal` and `verify` take the exclusive form of the same lock for sealing only. `seal` seals rows with `seq` greater than the last seal's `to_seq` in chunks of `windowRows` until none remain, each chunk chained with `prev_seal_hash`; `verify` walks seals in order in pages of 100 so large tables never load whole.

- [ ] **Step 1: Write failing tests**:
  - `audit-writer`: a success entry is visible only after its transaction commits and is gone on rollback; `diff` with `password` and a caller `sensitiveKeys: ['contract_value']` is stored redacted; `recordDenied` writes `outcome = 'DENIED'` and survives when the caller's command transaction rolls back; invalid classification is rejected by the CHECK; the `machvon_app` role cannot update or delete the row; `NIL_RESOURCE_ID` is accepted for a denied create; tenant B cannot read tenant A's rows.
  - `audit-seal-job`: with 1,000 entries and `windowRows: 1000` one seal covers `from_seq..to_seq` of the tenant's rows; a second `seal` with no new rows returns `{ sealed: 0, seals: 0 }`; 25 rows with `windowRows: 10` give seals of 10, 10, 5 chained by `prev_seal_hash`; two tenants interleaved get independent chains; a writer transaction holding its shared lock makes `seal` wait and the late row ends up in the next window, never inside the sealed one (use two connections and a deferred commit).
  - `audit-tamper` (UAT-AC139, AC-ST-KERNEL-023-2): 50 sealed entries with `windowRows: 10`; the owner role edits the 25th row's `action`; `verify` returns `ok: false` with `reason: 'ROOT_MISMATCH'` and `fromSeq <= seq25 <= toSeq`, the `AlertSink` received `AUDIT_CHAIN_BROKEN` with the tenant id and window, and `audit_seal_failures_total` was incremented; further variants: owner deletes a row, owner inserts a row with a `seq` inside a sealed window, owner inserts a row in the gap between two seals (`UNSEALED_ROW_IN_GAP`), owner rewrites `prev_seal_hash` (`CHAIN_LINK_MISMATCH`), owner rewrites `seal_hash` (`SEAL_HASH_MISMATCH`); an untouched chain verifies `ok: true`; tamper in tenant A never fails tenant B.
- [ ] **Step 2: Run** `npm test -w @machvon/db -- audit`; expected FAIL.
- [ ] **Step 3: Implement** per the Interfaces. Write both runbooks (what the alert means, who is paged, the SQL to read the failing window, the drill steps and evidence template with a table of columns `date`, `operator`, `tampered row`, `detected by`, `time to alert`).
- [ ] **Step 4: Run** `npm test -w @machvon/db && npm run lint && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit** `feat(db): add tamper-evident audit writer, sealer and verifier`.

### Task 6: Command pipeline interceptor in the API (ST-ADM-001 TK-2/3/7, ST-ADM-002 TK-2, ST-KERNEL-023 acceptance 3)

**Files:**
- Create: `apps/api/src/command.decorator.ts`, `apps/api/src/command.interceptor.ts`, `apps/api/src/command-scope.ts`
- Modify: `apps/api/src/problem.filter.ts` (emit `extensions` as top-level members and `headers` as response headers; never from non-`DomainError`), `apps/api/src/app.module.ts` (register `IdempotencyStore`, `AuditWriter`, `APP_INTERCEPTOR`)
- Test: `apps/api/test/command-pipeline.test.ts`, `apps/api/test/command-test-controller.ts` (test-only controller registered by the test module), update `apps/api/test/problem.filter.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5, `TestAuthGuard` and `startTestApp` from `test/isolation/test-app.ts`.
- Produces:
  ```ts
  @Command({ operation: string; ttl?: IdempotencyTtl; versioned?: boolean })   // method decorator, also marks the handler for the conformance gate
  interface CommandScope { tx: TenantTx; tenant: TenantContext; requestId: string; correlationId: string; expectedVersion: number | null;
    audit(entry: AuditEntry): Promise<string>; emit(event: Omit<OutboxEventInput, 'correlationId'>): Promise<{ id: string; duplicate: boolean }> }
  const Scope: ParameterDecorator   // injects the CommandScope
  ```
  The interceptor: parses `Idempotency-Key` (and `If-Match` when `versioned`), computes the hashes from `body`, route params and the raw `If-Match`, calls `begin`, maps `conflict` and `in_progress` to `DomainError` (`IDEMPOTENCY_CONFLICT` 409; `IDEMPOTENCY_IN_PROGRESS` 409 with header `Retry-After: 2`), on `replay` returns the stored success body with the stored status and header `Idempotency-Replayed: true` or rethrows the stored problem with the same header; otherwise opens `database.withTenant`, runs the handler with the scope, fails with `INTERNAL_ERROR` (rolling back) when the handler recorded no audit entry, calls `completeInTx`, and sets `ETag` when the response body has an integer `version`. After a rollback a `DomainError` with 4xx status is stored through `finishOutsideTx` as non-retryable (and a 403 additionally calls `recordDenied` with action `command.denied:<operation>`), anything else as retryable; the original error is rethrown. `requestId` is a fresh UUID; `correlationId` is `x-correlation-id` when a UUID, else fresh.

- [ ] **Step 1: Write failing tests** with a test controller offering `POST /test/widgets` (`@Command({operation:'createWidget'})`, writes a row in a test table through `scope.tx`, one audit entry, one `emit`), `PUT /test/widgets/:id` (`versioned: true`, uses `versionConflict`), `POST /test/widgets/deny` (throws `DomainError('SCOPE_DENIED', 403)`), `POST /test/widgets/fail` (throws a plain `Error`), `POST /test/widgets/silent` (no audit):
  - missing and short `Idempotency-Key` give 400 `INVALID_REQUEST` and no row, audit or outbox;
  - AC-ST-KERNEL-028-1: first call 200 with version 5, replay returns the identical body with `Idempotency-Replayed: true`, another body gives 409 `IDEMPOTENCY_CONFLICT`; exactly one widget row, one audit row, one outbox row;
  - 20 parallel identical calls: one widget row, every response either 200 (original or replay) or 409 `IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 2`;
  - AC-ST-KERNEL-028-2: two `PUT` with `If-Match: "7"`: one 200 with `ETag: "8"`, one 409 `VERSION_CONFLICT` whose problem body has `current_version: 8`; without `If-Match` 428;
  - AC-ST-KERNEL-028-3: `/fail` returns 500 `INTERNAL_ERROR` without internals in the body, record is `FAILED_RETRYABLE`, no audit or outbox row of the attempt exists, and a retry with the same key to the (now healed) handler runs normally;
  - `/deny`: 403, the response replays with the same problem for the same key, a `DENIED` audit row exists although the command transaction rolled back, the success path of `/widgets` wrote its `SUCCESS` row in the same transaction as the widget (a transaction aborted after the audit insert leaves neither);
  - `/silent` gives 500 and rolls back the business row;
  - a request without a verified tenant context is rejected before `begin` (no `idempotency_record` row);
  - tenant A and tenant B using the same key and body each execute once.
- [ ] **Step 2: Run** `npm test -w @machvon/api -- command-pipeline problem.filter`; expected FAIL.
- [ ] **Step 3: Implement** per the Interfaces; the filter change must keep every existing leakage test green.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture` from the root; expected PASS, coverage at least 90 percent.
- [ ] **Step 5: Commit** `feat(api): add idempotent, versioned, audited command pipeline`.

### Task 7: Command conformance generator and CI gate (ST-KERNEL-028 TK-1/3)

**Files:**
- Create: `apps/api/test/conformance/command-cases.ts`, `apps/api/test/conformance/command-conformance.test.ts`, `scripts/command-coverage.mjs`
- Modify: `package.json` (script `commands:check`), `ci/config.json` and the `product-tests` stage in `ci/src/verify.mjs` (run `npm run commands:check`), `ci/test/verify.test.mjs`
- Test: `scripts/command-coverage.test.mjs`

**Interfaces:**
- Consumes: Task 6 `@Command`, `implementedOperationIdsOf`, `loadOpenApi`.
- Produces: `commandCasesFor(operation: { operationId: string; method: string; path: string; versioned: boolean }): CommandCase[]` where `CommandCase = { id: string; description: string; run(client: HttpClient): Promise<void> }` generating, for every write operation (POST, PUT, PATCH, DELETE) in `openapi.json`: missing key, replay, conflict and, when the operation declares the `If-Match` header parameter, missing `If-Match` (428) and stale `If-Match` (409); `commandCoverage(root: string): Promise<{ writeOperations: number; implemented: string[]; uncovered: string[] }>` in `scripts/command-coverage.mjs`, where `uncovered` lists implemented write operations (handler has `@OperationId` and a write verb) whose handler lacks `@Command`; the CLI prints the counts and exits 1 when `uncovered` is non-empty.

- [ ] **Step 1: Write failing tests**: `commandCasesFor` on a POST with and without the `If-Match` parameter returns three and five cases with stable ids `<operationId>:missing-key` and so on; `commandCoverage` on a scratch tree with one handler decorated `@OperationId('x')` but not `@Command` lists `x` as uncovered and on a decorated one reports none; the conformance test runs the generated cases against the Task 6 sample commands (three operations standing in for ADM, PRJ and CAP modules) and all pass; a deliberately broken sample (handler that ignores the key) makes its generated case fail (negative control).
- [ ] **Step 2: Run** `node --test scripts/command-coverage.test.mjs` and `npm test -w @machvon/api -- conformance`; expected FAIL.
- [ ] **Step 3: Implement** the generator over the OpenAPI document and the script using the Nest metadata keys exported by `command.decorator.ts`; wire `commands:check` into the CI stage with messages in `ci/src/messages/{vi,en}.json`.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check && (cd ci && npm test)`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): generate command conformance cases and gate undecorated writes`.

### Task 8: Close M2b (PROGRESS, readiness, final review, push)

**Files:**
- Modify: `PROGRESS.md`, `Design/MACHVON_Design/03_Engineering/implementation_readiness.json` only if the counts it holds changed, `TODOS.md` (carry-overs: job scheduling, alert routing, audit read endpoints, TK-4 of ST-KERNEL-028, per-row tamper localisation change request)

- [ ] **Step 1: Run** the full verification: `npm test && npm run lint && npm run typecheck && npm run architecture && npm run commands:check && npm run db:check` and `cd ci && npm test`; expected all PASS.
- [ ] **Step 2: Review** the whole branch with `/review` and the Codex review; fix findings with a regression test each, repeat until none remain.
- [ ] **Step 3: Update PROGRESS.md** (milestone line, decisions table from this plan, test counts, carry-overs), then commit `docs: record M2b completion` and push to `origin main` after the pre-push gates pass.
- [ ] **Step 4: Write the M2c plan** (IAM-004 PDP, ADM-004/005, SAS registry, web shell) from `implementation_plan.json` R0 order and record it as the next step in PROGRESS.md.

## Parallel execution (maximum 5 agents)

Task 1 first, alone. Then Tasks 2, then in parallel Task 3, Task 4 and Task 5 (each in its own files; only `packages/db/src/index.ts` is shared, so the exports are added by the integrating agent). Task 6 needs 2, 3, 4, 5; Task 7 needs 6; Task 8 last.

## Self-Review

- **Spec coverage:** ADM-001 AC-1 to Tasks 3 and 6 (replay, conflict, in progress with `Retry-After`), AC-2 to Task 6 (one audit and one outbox row, missing key 400), AC-3 to Task 4 `delivery-recovery`, AC-4 to Tasks 2 and 6 (`If-Match`, 409, 428); ADM-002 AC-1 to Task 5 `audit-tamper` plus Task 1 triggers, AC-2 to Tasks 5 and 6 (denied row in a separate transaction); KERNEL-023 AC-1 to Task 1, AC-2 to Task 5 (window granularity, see decisions), AC-3 to Task 6; KERNEL-028 AC-1 to AC-3 to Task 6, generator and gate to Task 7. Not covered here and logged: scheduling, alert routing, read endpoints, run against 10 modules.
- **Type consistency:** `TenantTx`, `TenantContext`, `AuditEntry`, `OutboxEventInput`, `IdempotencyTtl` are defined once (Tasks 2 to 5) and used unchanged in Task 6; `DomainError`'s fourth argument is defined in Task 2 and used by the filter in Task 6.
- **Review Focus:** each line has a test: parallel keys (Task 3 and 6), failure after `begin` (Task 6), expired lock takeover (Task 3), canonical hashing (Task 2), redaction and CHECK (Tasks 2 and 5), tamper variants (Task 5).
