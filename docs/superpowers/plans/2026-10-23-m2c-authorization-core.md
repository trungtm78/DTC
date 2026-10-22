# M2c Authorization Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every request is authorised by one policy decision point (PDP) that computes effective access from grants, scopes and the organisation tree, and the commands that change that data (organisation units, custom roles, role grants) cannot be used to escalate privilege.

**Architecture:** `packages/kernel` holds the pure PDP (permission patterns, scope algebra, effective permissions, decision with reasons) so it can be property-tested without a database; `packages/db` loads `EffectiveAccess` from PostgreSQL, caches it by `scope_version`, compiles scopes into SQL predicates and holds the hand-written migration V004; `apps/api` adds the policy guard (permission, step-up, plane read from `openapi.json` through the generated tables) and the six commands, all built on the M2b `@Command` pipeline.

**Tech Stack:** Same as M2b (Node 24, TypeScript strict, NestJS 11, Jest with `@swc/jest`, `pg`, embedded PostgreSQL 18, `fast-check` for property tests).

**Spec:** `Design/MACHVON_Design/03_Engineering/implementation_plan.json` stories ST-IAM-004, ST-ADM-004 and ST-ADM-005 (backend tasks only), ST-KERNEL-027 (the generated negative matrix for the commands that exist); `Design/MACHVON_Design/01_Documents/05_modules/IAM.md` sections 2, 3.4, BR-IAM-01 to BR-IAM-13 and section 6; `Design/MACHVON_Design/01_Documents/05_modules/ADM.md` for ADM-01 and ADM-03; `schema_reference.sql` tables `organization_unit`, `membership`, `role_definition`, `role_grant`; `AUTONOMOUS_EXECUTION_PROTOCOL.md`.

**Out of scope for M2c (later plans, logged in PROGRESS.md):** all web screens (ADM-01, ADM-03: web shell and tokens, ST-KERNEL-031/-111, plan M2d); sign-in, token exchange and the real `sv` claim (ST-IAM-002/-003, need Keycloak, plan M2d); delegations (ADM-04) and membership commands (ADM-006), so `Effective` here has no delegation term and the revocation lag measurement runs against grants only; Redis server (the cache is a port with an in-memory implementation); entitlement term of BR-IAM-03 (ST-SAS-002): the calculator takes an optional `entitled(permission)` predicate that defaults to allow-all; unit reorganisation saga (ADM-16, BR-IAM-10).

## Global Constraints

- All M2a and M2b constraints still apply (English code, i18n keys for user text, 90 percent patch coverage, strict TypeScript, no `TODO`/`@ts-ignore`/empty `catch`, Conventional Commits, no force push, pre-push gates, migrations after V003 hand-written).
- Effective access (BR-IAM-03): union of the permissions of every grant of the membership whose `status = 'Active'` and `effective_from <= now < effective_until` and whose scope contains the resource; a membership that is not `Active` or past `valid_until` has the empty set.
- Scopes (BR-IAM-04): `TENANT`; `UNIT_SUBTREE[u]` contains resources whose owner unit path starts with `u.path`; `UNIT_ONLY[u]` only `u`; `PROJECT[p]`; `CONTRACT[c]`. Unit path is `/<root>/<…>/<id>/`, depth at most 8.
- Anti-escalation (BR-IAM-05) for `grantRole`, `createCustomRole`, `updateCustomRole`: (a) grantor holds `iam.role.grant` on a scope containing the requested scope, else 403 `SCOPE_OUT_OF_GRANTOR_RANGE`; (b) `rank(role)` is below the grantor's highest rank within that scope, else 403 `ROLE_ESCALATION_DENIED`; (c) every permission of the role is in the grantor's effective permissions on that scope, else 403 `ROLE_ESCALATION_DENIED`; (d) recipient differs from grantor, else 403 `SELF_GRANT_DENIED`; (e) no `system.*` permission, else 422 `SYSTEM_PERMISSION_NOT_GRANTABLE` and the table CHECK of `role_definition`. Custom role rank 1 to 89 (outside gives 400 `INVALID_REQUEST`); system roles are immutable (409 `SYSTEM_ROLE_IMMUTABLE`); revoking or ending the last `TENANT_OWNER` gives 409 `LAST_TENANT_OWNER`; acting on oneself gives 403 `SELF_ACTION_DENIED`.
- Decision order of the guard (IAM 3.4): plane (a `x-plane: control` operation refuses a tenant-plane token with 403 `SCOPE_DENIED`), session deny-list, `scope_version` compare (the database value wins), permission on the target scope, entitlement, step-up (`x-step-up: aal2` needs `aal2` within 15 minutes, else 403 `MFA_REQUIRED`). Deny answers 403 `SCOPE_DENIED` for commands and 404 `RESOURCE_NOT_FOUND` for reads outside scope; a denied command writes a `DENIED` audit row in a separate transaction (M2b `recordDenied`).
- System roles are seeded per tenant (13 rows: TENANT_OWNER 99, TENANT_ADMIN 90, SECURITY_ADMIN 85, UNIT_ADMIN 70, LEADER 60, NOTIFICATION_ADMIN 50, OMNI_SUPERVISOR 50, SPECIALIST 40, OMNI_AGENT 35, INVESTOR_OFFICER 30, AUDITOR 25, BILLING_VIEWER 20, GUEST_CONTRACTOR 10, MEMBER 5; `guest_allowed` true for GUEST_CONTRACTOR and MEMBER).
- Permission sets of system roles are stored as patterns as IAM.md writes them (`iam.*`, `adm.*`, `audit.read`); a trailing `.*` matches every permission with that prefix, and `system.*` is never part of a stored role.

## Decisions taken without asking (also written to PROGRESS.md)

| Point | Decision | Basis |
|---|---|---|
| `membership.scope_version` does not exist in `schema_reference.sql` although BR-IAM-03 and BR-IAM-13 require it | V004 adds `membership.scope_version bigint NOT NULL DEFAULT 1`; a change request is queued in TODOS.md | IAM.md section 5, baseline preservation |
| Exact permission list of each system role is not in the design | Patterns taken verbatim from the IAM.md role table (column "Quyền tiêu biểu"); anything the table does not name is not granted; the matrix is marked `CHỜ KÝ` for the business owner | protocol exception D-B04 |
| Rank 95 custom role answers 400 | Validated in the command handler with `INVALID_REQUEST` because DTO validation from `openapi.json` is not generated yet | AC-ST-ADM-005-4 |
| Cache | `AuthzCache` port keyed `authz:{tid}:{mid}:{sv}` with TTL 60 s, in-memory implementation now, Redis later; keys built with the M2a `tenantKey` helper | IAM 3.4, ST-KERNEL-024 |
| Session deny-list and `iam.access.changed.v1` | Ports `SessionDenyList` and an event handler `onAccessChanged(event)` that deletes the membership's cache keys; transports arrive with Keycloak and Redis | IAM 3.4 |

## Review Focus

- A grant whose window ended one millisecond ago, a grant that starts in the future and a grant of a `Suspended` membership grant nothing; a window that ends exactly now is already over.
- A unit whose path is a string prefix of another unit's path by accident (`/a/12/` vs `/a/1/`) must not widen `UNIT_SUBTREE`; the match is on whole path segments.
- Moving a unit under its own descendant, under itself, to depth 9, or onto a code taken by a sibling leaves the tree untouched (no partial path rewrite) and the failed command's idempotency record is not poisoned.
- Two concurrent moves that together would create a cycle: exactly one commits, the other gets 422 `UNIT_CYCLE`.
- A grantor granting a role containing a permission pattern broader than their own (`iam.*` when they hold `iam.unit.manage`) is refused; a role with an empty permission list, a duplicate permission, or a permission name that is not in the catalogue is refused with 422 `VALIDATION_FAILED`.
- A token that carries an old `sv` after a revoke in another transaction is denied on the very next request, and a cache entry written for the old `sv` is never served for the new one.

---

### Task 1: Migration V004, seeded system roles and role/grant guards (ST-IAM-004 TK-1, ST-ADM-005 TK-3)

**Files:**
- Create: `db/migrations/V004__authorization_core.sql`, `packages/db/src/system-roles.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/authorization-migration.test.ts`, `packages/db/test/system-roles.test.ts`

**Interfaces:**
- Produces: column `membership.scope_version bigint NOT NULL DEFAULT 1`; `CHECK (is_system OR rank <= 89)` on `role_definition`; `REVOKE DELETE, TRUNCATE ON machvon.role_grant FROM machvon_app` plus a `BEFORE DELETE` trigger rejecting deletes for every role but `machvon_owner`; index `role_grant_scope_ref_ids_gin` (GIN on `scope_ref_ids`) and `role_grant_membership_idx (tenant_id, membership_id) WHERE status = 'Active'`.
  ```ts
  interface SystemRole { code: string; name: string; rank: number; permissions: readonly string[]; guestAllowed: boolean }
  const SYSTEM_ROLES: readonly SystemRole[]            // the 13 roles above with the patterns of IAM.md
  function seedSystemRoles(tx: TenantTx, createdBy: string): Promise<{ inserted: number }>   // idempotent: ON CONFLICT (tenant_id, code) DO NOTHING
  ```

- [ ] **Step 1: Write the failing tests**: after `startMigratedTestDatabase` the app role gets `42501` on `DELETE FROM role_grant` and `TRUNCATE`, the owner can delete (tamper drill parity with V003), `INSERT` of a custom role with rank 95 and `is_system = false` violates the CHECK while a system role of rank 99 passes, a role whose `permissions` contains `system.tenant.manage` is refused by the existing CHECK, `scope_version` defaults to 1; `seedSystemRoles` inserts 13 rows once (second call inserts 0), ranks and `guest_allowed` as in Global Constraints, no stored permission starts with `system.`, every `x.*` pattern of the seed matches at least one permission of the generated catalogue (`PERMISSIONS` from `@machvon/contracts`), and tenant B cannot see tenant A's roles.
- [ ] **Step 2: Run** `cd packages/db && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js test/authorization test/system-roles`; expected FAIL.
- [ ] **Step 3: Write V004** (header comment as in V003, hand-written) and `system-roles.ts`; the permission patterns are copied from the "Quyền tiêu biểu" column, for example TENANT_ADMIN `['iam.*','adm.*','audit.read']`, UNIT_ADMIN `['iam.member.*','iam.role.grant','iam.unit.manage']`, SPECIALIST `['review.*']` only when the catalogue test finds a match, otherwise the exact permissions named by the text; rows the design leaves open get an empty `permissions` array and a comment `CHỜ KÝ`.
- [ ] **Step 4: Run** `npm test -w @machvon/db && npm run db:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(db): add authorization migration and seeded system roles`.

### Task 2: Pure PDP in the kernel (ST-IAM-004 TK-2 core)

**Files:**
- Create: `packages/kernel/src/permission.ts`, `scope.ts`, `effective-access.ts`, `decision.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/{permission,scope,effective-access,decision}.test.ts`, `packages/kernel/test/pdp.property.test.ts`

**Interfaces (all exported from `@machvon/kernel`):**
- `permissionMatches(held: string, required: string): boolean` (`'iam.*'` matches `'iam.role.grant'` and `'iam.x'`, not `'iamx.y'`, not `'iam'`; exact match otherwise; a held bare `'*'` never matches).
- `type Scope = { kind: 'TENANT' } | { kind: 'UNIT_SUBTREE' | 'UNIT_ONLY' | 'PROJECT' | 'CONTRACT'; refIds: readonly string[]; paths?: readonly string[] }`; `interface ResourceRef { ownerUnitPath: string; ownerUnitId: string; projectId?: string; contractId?: string }`; `scopeContains(scope: Scope, resource: ResourceRef): boolean` (whole path segments only); `scopeCovers(outer: Scope, inner: Scope): boolean` (needed by anti-escalation (a); `TENANT` covers all, `UNIT_SUBTREE` covers `UNIT_ONLY`/`UNIT_SUBTREE` whose paths start with one of its paths, otherwise the ref ids of `inner` must be a subset).
- `interface GrantView { roleCode: string; rank: number; permissions: readonly string[]; scope: Scope; status: string; effectiveFrom: Date; effectiveUntil: Date | null }`; `interface EffectiveAccess { membershipId: string; scopeVersion: number; membershipActive: boolean; grants: readonly GrantView[] }`; `activeGrants(access: EffectiveAccess, now: Date): GrantView[]`; `effectivePermissions(access: EffectiveAccess, now: Date, resource?: ResourceRef): Set<string>` (permission patterns kept as held strings); `maxRank(access, now, scope: Scope): number` (0 when none).
- `type Decision = { allow: true } | { allow: false; reason: 'PLANE' | 'SESSION_REVOKED' | 'STALE_SCOPE_VERSION' | 'NO_PERMISSION' | 'ENTITLEMENT' | 'STEP_UP'; code: 'SCOPE_DENIED' | 'ENTITLEMENT_DENIED' | 'MFA_REQUIRED'; status: 403 }`; `decide(input: { required: { permission: string; plane: 'tenant' | 'control' | 'internal' | 'edge'; stepUp?: 'aal2' }; principal: { audience: 'tenant' | 'control' | 'internal' | 'edge'; assurance: 'aal1' | 'aal2'; aal2At?: Date; sessionRevoked: boolean; tokenScopeVersion: number }; access: EffectiveAccess; resource?: ResourceRef; now: Date; entitled?: (permission: string) => boolean }): Decision` applying the order in Global Constraints (step-up window 15 minutes).

- [ ] **Step 1: Write failing tests**: `permissionMatches` table of 10 cases above; `scopeContains` with `/a/12/` vs `/a/1/`, root unit, `UNIT_ONLY`, `PROJECT`, `CONTRACT` with and without ids; window edges (`effectiveUntil === now` is over, `effectiveFrom === now` is active); non-Active membership gives the empty set; `decide` returns `PLANE` for a tenant token on a control operation, `STALE_SCOPE_VERSION` when `tokenScopeVersion < access.scopeVersion` and the permission was removed (the DB value wins; a token with an equal or newer value is not stale), `STEP_UP` with 403 `MFA_REQUIRED` when `aal1`, or `aal2` older than 15 minutes, allow once `aal2At` is within 15 minutes; property tests with `fast-check` (add as a root devDependency): effective permissions never contain a permission that no active grant holds, adding a grant never removes a permission, `scopeCovers` is reflexive and transitive over generated scopes, and `decide` never allows when the permission set lacks the permission.
- [ ] **Step 2: Run** `npm test -w @machvon/kernel`; expected FAIL.
- [ ] **Step 3: Implement** the four modules with the signatures above; all pure, no I/O.
- [ ] **Step 4: Run** `npm test -w @machvon/kernel && npm run lint && npm run typecheck`; expected PASS, 90 percent coverage.
- [ ] **Step 5: Commit** `feat(kernel): add pure policy decision point`.

### Task 3: EffectiveAccess from the database, cache and revocation (ST-IAM-004 TK-2/4, AC-3)

**Files:**
- Create: `packages/db/src/effective-access-store.ts`, `packages/db/src/authz-cache.ts`, `packages/db/src/scope-version.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/{effective-access-store,authz-cache,scope-version}.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 2 `EffectiveAccess`, `tenantKey` and `KeyValueStore` from the kernel.
- Produces:
  ```ts
  interface AuthzCache { get(tenantId: string, membershipId: string, scopeVersion: number): Promise<EffectiveAccess | undefined>; set(access: EffectiveAccess, tenantId: string, ttlSeconds: number): Promise<void>; invalidate(tenantId: string, membershipId: string): Promise<void> }
  class InMemoryAuthzCache implements AuthzCache { constructor(now?: () => number) }
  class EffectiveAccessStore {
    constructor(database: TenantDatabase, cache: AuthzCache, options?: { ttlSeconds?: number; metrics?: MetricsSink });   // ttl default 60
    load(ctx: TenantContext): Promise<EffectiveAccess>;    // cache key by the DB scope_version, so a stale token never reads a newer entry
    currentScopeVersion(ctx: TenantContext): Promise<number>;
    onAccessChanged(event: { tenantId: string; membershipIds: readonly string[] }): Promise<void>;   // iam.access.changed.v1 consumer
  }
  function bumpScopeVersion(tx: TenantTx, membershipIds: readonly string[]): Promise<void>;          // UPDATE ... SET scope_version = scope_version + 1
  function membershipsAffectedByUnits(tx: TenantTx, unitIds: readonly string[]): Promise<string[]>;   // memberships with an Active grant whose scope touches those units' subtrees
  function scopePredicate(access: EffectiveAccess, permission: string, now: Date, column: { unitPath: string; unitId: string }): { sql: string; params: unknown[] } | { sql: 'false'; params: [] };   // SQL predicate compiler for list reads
  ```
  `load` reads membership, active grants joined to `role_definition` and the unit paths of unit scopes, in one tenant transaction (the guard, not the store, counts `authz_decision_total`); `scopePredicate` produces `(unit_path LIKE $1 || '%' OR unit_id = ANY($2) ...)` over whole path segments for the permission's grants, or `false`.

- [ ] **Step 1: Write failing tests** (real PostgreSQL, two tenants): `load` returns the grants with scope paths and the DB `scope_version`; a membership with status `Suspended` or past `valid_until` loads with `membershipActive = false`; the second `load` is served from the cache (count queries through a spy pool), a bump of `scope_version` makes the next `load` read the database even before the TTL, entries expire after 60 s (injected clock), `onAccessChanged` deletes the keys of only the listed memberships; `bumpScopeVersion` increments once per listed membership in one statement and `membershipsAffectedByUnits` finds the holders of an ancestor `UNIT_SUBTREE` grant and of a `UNIT_ONLY` grant on the unit but not a holder on a sibling; `scopePredicate` run against a seeded tree returns exactly the rows `scopeContains` allows, including the `/a/12/` vs `/a/1/` case, and `false` when no grant carries the permission; tenant B's membership never loads tenant A's grants.
- [ ] **Step 2: Run** the three files; expected FAIL.
- [ ] **Step 3: Implement** as described; the cache serialises `EffectiveAccess` as JSON with ISO dates.
- [ ] **Step 4: Run** `npm test -w @machvon/db && npm run lint && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit** `feat(db): add effective access store, cache and scope predicates`.

### Task 4: Policy guard in the API (ST-IAM-004 TK-3/6, AC-1/2/4)

**Files:**
- Create: `apps/api/src/policy.guard.ts`, `apps/api/src/principal.ts`, `apps/api/src/policy.module.ts`
- Modify: `packages/contracts/src/generate.ts` (emit `STEP_UP` and `PLANES` tables next to `PERMISSIONS`), `packages/contracts/src/permissions.generated.ts` (regenerated), `apps/api/src/command.interceptor.ts` (record the decision outcome on the scope), `apps/api/test/isolation/test-auth.guard.ts` (optional claims in the test token)
- Test: `apps/api/test/policy-guard.test.ts`, `packages/contracts/test/generate.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3, M2b `AuditWriter.recordDenied`, `OperationId` metadata, generated `PERMISSIONS`.
- Produces:
  ```ts
  interface Principal { tenant: TenantContext; audience: 'tenant' | 'control' | 'internal' | 'edge'; assurance: 'aal1' | 'aal2'; aal2At?: Date; sessionId: string }
  const PRINCIPAL_REQUEST_KEY = 'principal';
  interface SessionDenyList { isRevoked(sessionId: string): Promise<boolean> }
  class PolicyGuard implements CanActivate {   // APP_GUARD after the authentication guard
    constructor(reflector: Reflector, access: EffectiveAccessStore, denyList: SessionDenyList, audit: AuditWriter, options?: { metrics?: MetricsSink; entitled?: (tenantId: string, permission: string) => boolean; now?: () => Date })
  }
  PolicyModule.register(options): DynamicModule
  ```
  The guard maps the handler's `@OperationId` to `PERMISSIONS[operationId]`, `STEP_UP[operationId]` and `PLANES[operationId]`; a handler with an operationId that has no entry is refused at start-up (the application fails to boot) so a route can never ship unprotected; a route without `@OperationId` is public only when it carries `@Public()`. It loads access with `EffectiveAccessStore.load`, calls `decide`, and on deny throws `DomainError(code, 403)` (reads outside scope are the handler's 404). For commands it records `recordDenied` with action `authz.denied:<operationId>` and `diff: { reason }`. It increments `authz_decision_total` with labels `outcome` and `reason`.

- [ ] **Step 1: Write failing tests** with sample controllers: AC-ST-IAM-004-1 a command the caller lacks is 403 `SCOPE_DENIED` with one `DENIED` audit row (also when no UI exists for it); AC-2 a LEADER with `aal1` calling a `x-step-up: aal2` command gets 403 `MFA_REQUIRED`, with `aal2At` 14 minutes ago 200, 16 minutes ago 403; AC-3 revoke the grant in the database (and bump the version) while the token carries the old `sv`: the next request is denied, and a cached entry of the old version is not used (measure with the cache enabled); AC-4 a tenant-plane token on an `x-plane: control` operation is 403 `SCOPE_DENIED`; a revoked session id is 401 `SESSION_EXPIRED`; an unmapped operationId makes `NestFactory`/test app creation throw; `@Public()` routes skip the guard; `generate.test.ts` asserts `STEP_UP.grantRole === 'aal2'` and `PLANES.<a control operation> === 'control'` and that regeneration is deterministic.
- [ ] **Step 2: Run** `npm test -w @machvon/api -- policy-guard` and `npm test -w @machvon/contracts`; expected FAIL.
- [ ] **Step 3: Implement** the generator additions and the guard; the test authentication guard accepts optional `aud`, `aal`, `aal2At`, `sid` claims inside the signed token payload.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture && npm run contracts:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): add policy guard with plane, step-up and revocation checks`.

### Task 5: Organisation unit commands (ST-ADM-004 backend)

**Files:**
- Create: `apps/api/src/org-units.commands.controller.ts`, `packages/db/src/org-unit-tree.ts`
- Modify: `apps/api/src/organization-units.controller.ts` (read DTO limited to the reader's subtree through `scopePredicate`), `apps/api/src/app.module.ts`
- Test: `packages/db/test/org-unit-tree.test.ts`, `packages/db/test/org-unit-tree.property.test.ts`, `apps/api/test/org-units-commands.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4, M2b `@Command`/`@Scope`.
- Produces (db): `createUnit(tx, input: { code; name; parentId; unitType; validFrom; validUntil?; isInvestor?; administrativeCode?; legalBasisRef? }): Promise<{ id: string; path: string; depth: number }>`; `renameOrUpdateUnit(tx, id, patch): Promise<void>`; `moveUnit(tx, id, newParentId, effectiveFrom: string): Promise<{ affectedUnitIds: string[]; oldPath: string; newPath: string }>` locking the subtree `FOR UPDATE` in path order, rewriting every descendant path in one statement, refusing `UNIT_CYCLE` (new parent is the unit or inside its subtree), `UNIT_DEPTH_EXCEEDED` (deepest descendant would pass depth 8), `UNIT_CODE_TAKEN` (unique code among Planned/Active, enforced by a partial unique index added in V004 if the design lacks it, and mapped from SQLSTATE `23505`), `UNIT_VALIDITY_INVALID` (child validity must sit inside the parent's).
- Produces (api): commands `createOrganizationUnit` (POST /org-units), `updateOrganizationUnit` (PUT /org-units/{unitId}, versioned), `moveOrganizationUnit` (POST /org-units/{unitId}/move, versioned), each `@Command`, with audit rows (`org_unit.create|update|move`) and outbox events `iam.org_unit.created.v1|updated.v1|moved.v1`; a move bumps `scope_version` of every membership from `membershipsAffectedByUnits` in the same transaction and emits `iam.access.changed.v1`.

- [ ] **Step 1: Write failing tests**: AC-ST-ADM-004-1 cycle 422 `UNIT_CYCLE`, depth 9 422 `UNIT_DEPTH_EXCEEDED`, duplicate code 409 `UNIT_CODE_TAKEN`, child validity outside parent 422 `UNIT_VALIDITY_INVALID`, each leaving the tree and the idempotency record consistent; AC-2 a move changes every descendant path in one transaction (a failing statement mid-way leaves all old paths) and bumps `scope_version` of exactly the affected memberships; two concurrent opposing moves (A under B, B under A) commit one and refuse one with `UNIT_CYCLE`; property test with `fast-check`: random trees up to 8 levels and random sequences of valid and invalid moves keep every path equal to the path derived from `parent_id` and every depth equal to the segment count; a reader with `UNIT_SUBTREE` on one unit lists only that subtree and gets 404 for a unit outside it; every command denied for a caller without `iam.unit.manage` (guard) and for tenant B's unit ids.
- [ ] **Step 2: Run** the new test files; expected FAIL.
- [ ] **Step 3: Implement** the tree module and the three commands; map `23505` on the code index to `UNIT_CODE_TAKEN`.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check`; expected PASS (the gate now lists three implemented write operations).
- [ ] **Step 5: Commit** `feat(api): add organisation unit commands with subtree move`.

### Task 6: Custom roles and grants with anti-escalation (ST-ADM-005 backend)

**Files:**
- Create: `packages/kernel/src/anti-escalation.ts`, `apps/api/src/roles.controller.ts`, `apps/api/src/role-grants.controller.ts`, `packages/db/src/role-store.ts`
- Modify: `packages/kernel/src/index.ts`, `apps/api/src/app.module.ts`
- Test: `packages/kernel/test/anti-escalation.test.ts`, `packages/kernel/test/anti-escalation.property.test.ts`, `apps/api/test/roles-and-grants.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces (kernel, pure): `checkGrant(input: { grantor: EffectiveAccess; recipientMembershipId: string; role: { rank: number; permissions: readonly string[]; isSystem: boolean }; requestedScope: Scope; now: Date }): { ok: true } | { ok: false; code: 'SCOPE_OUT_OF_GRANTOR_RANGE' | 'ROLE_ESCALATION_DENIED' | 'SELF_GRANT_DENIED' | 'SYSTEM_PERMISSION_NOT_GRANTABLE'; status: 403 | 422 }` implementing (a) to (e) in that order of precedence: (d) first, then (e), (a), (b), (c); `checkRoleDefinition(input: { grantor; permissions; rank; now; scope }): same result type`.
- Produces (db): `RoleStore` with `createCustomRole(tx, input)`, `updateCustomRole(tx, id, input, expectedVersion)` (409 `SYSTEM_ROLE_IMMUTABLE` for system roles; bumps `scope_version` of every holder), `insertGrant(tx, input)`, `revokeGrant(tx, grantId, by, reason)`, `lockMembership(tx, membershipId)` (`FOR UPDATE`), `lastActiveOwnerGuard(tx, membershipId)` (409 `LAST_TENANT_OWNER`).
- Produces (api): commands `createCustomRole` (POST /roles), `updateCustomRole` (PUT /roles/{roleId}, versioned), `grantRole` (POST /role-grants, `x-step-up: aal2`), `revokeRoleGrant` (POST /role-grants/{grantId}/revoke, aal2), and the reads `get_resources_role_grant`, `get_resources_role_grant_id` limited to the caller's own grants unless they hold `iam.role.grant`; each command audits (`role.create|update`, `grant.create|revoke`), emits `iam.access.changed.v1` and bumps the recipient's `scope_version` in the same transaction; unknown permission names (not in the generated catalogue and not a pattern with a catalogue match) give 422 `VALIDATION_FAILED`; rank outside 1 to 89 gives 400 `INVALID_REQUEST`.

- [ ] **Step 1: Write failing tests**: pure tests for every row of AC-ST-ADM-005-1 to -5 (TENANT_ADMIN of rank 90 granting TENANT_ADMIN is `ROLE_ESCALATION_DENIED`, UNIT_ADMIN granting itself `SELF_GRANT_DENIED`, UNIT_ADMIN of one subtree granting on another department `SCOPE_OUT_OF_GRANTOR_RANGE` and in own subtree ok, a role with `system.*` 422, rank 95 400, permission broader than the grantor's `ROLE_ESCALATION_DENIED`); `fast-check` property: for any generated grantor access and any role, `checkGrant` is `ok` only if the role's rank is below the grantor's maximum rank in the scope and every role permission matches a grantor permission, and a successful chain of grants never lets a membership obtain a permission that no earlier grantor held; API tests: AC-6 a guest contractor calling `grantRole` gets 403 and a `DENIED` audit row; step-up required for `grantRole`; revoking the last TENANT_OWNER is 409 `LAST_TENANT_OWNER`; self revoke is 403 `SELF_ACTION_DENIED`; two concurrent grants to the same recipient serialise on the recipient lock and both versions are visible afterwards; every successful change increments the recipient's `scope_version` by exactly one and a subsequent request with the old `sv` is denied or re-evaluated.
- [ ] **Step 2: Run** the new test files; expected FAIL.
- [ ] **Step 3: Implement** the pure module first, then the store and the four commands.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): add custom roles and role grants with anti-escalation`.

### Task 7: Negative authorization matrix and revocation lag harness (ST-IAM-004 TK-5/7, ST-KERNEL-027 part)

**Files:**
- Create: `apps/api/test/authz/negative-matrix.ts`, `apps/api/test/authz/negative-matrix.test.ts`, `apps/api/test/authz/revocation-lag.test.ts`
- Modify: `scripts/command-coverage.mjs` and its test (list implemented commands with no row in the matrix)

**Interfaces:**
- Consumes: Tasks 4 to 6, the generated `PERMISSIONS`, `SYSTEM_ROLES`, M2b conformance harness.
- Produces: `negativeCasesFor(operations: { operationId: string; permission: string; plane: string }[], roles: readonly SystemRole[]): MatrixCase[]` generating, for every implemented command and every system role whose patterns do not match the command's permission, one case expecting 403 `SCOPE_DENIED` and a `DENIED` audit row, plus one case per command for a wrong-tenant token and one for a control-plane audience; `measureRevocationLag(options: { revocations: number; poll: () => Promise<boolean> }): Promise<{ p95Seconds: number; samples: number[] }>`.

- [ ] **Step 1: Write failing tests**: the matrix over the six commands of Tasks 5 and 6 and the 13 roles runs all generated cases green; a command whose guard is removed in a test fixture turns its cases red (negative control); the revocation test performs 100 revocations through `revokeRoleGrant` and polls a protected read with the old `sv` token until denied, asserting p95 under 60 seconds (in-process it will be well below; the assertion and the metric `access_revocation_lag_seconds` are what matter); `command-coverage` reports an implemented command that has no matrix row.
- [ ] **Step 2: Run** `npm test -w @machvon/api -- authz` and `node --test scripts/command-coverage.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** the generator, the measurement helper and the script extension (the matrix covers commands found by the same scan as `commandCoverage`).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit** `test(api): add generated negative authorization matrix and revocation lag harness`.

### Task 8: Close M2c (PROGRESS, review, push, M2d plan)

**Files:**
- Modify: `PROGRESS.md`, `TODOS.md` (carry-overs: change request for `membership.scope_version` and role matrix sign-off, delegation term, entitlement term, Redis and Keycloak transports, screens)

- [ ] **Step 1: Run** the full verification: `npm test && npm run lint && npm run typecheck && npm run architecture && npm run commands:check && npm run db:check && (cd ci && npm test)`; expected all PASS.
- [ ] **Step 2: Review** the whole range with `/review` and `/codex review --base origin/main`; fix every finding with a regression test, repeat until clean.
- [ ] **Step 3: Update PROGRESS.md** (milestone line, decisions table from this plan, test counts), commit `docs: record M2c completion` and push after the pre-push gates pass.
- [ ] **Step 4: Write the M2d plan** (web foundation: design tokens ST-KERNEL-031, web shell ST-KERNEL-111, then screens ADM-01 and ADM-03; Keycloak and sign-in when an environment exists) and record it as the next step in PROGRESS.md.

## Parallel execution (maximum 5 agents)

Task 1 and Task 2 in parallel (db versus kernel files). Then Task 3 (needs 1 and 2). Task 4 needs 3. Task 5 and Task 6 in parallel after 4, except that both edit `apps/api/src/app.module.ts` and `packages/db/src/index.ts`, which the integrating agent merges. Task 7 after 5 and 6. Task 8 last.

## Self-Review

- **Spec coverage:** IAM-004 AC-1 to Task 4 (and Task 7 matrix), AC-2 and AC-4 to Task 4, AC-3 to Tasks 3, 4, 7; ADM-004 AC-1 and AC-2 to Task 5, AC-3 (screen) is M2d; ADM-005 AC-1 to AC-6 to Task 6, AC-7 (screen) is M2d; KERNEL-027 negative matrix to Task 7 for the commands that exist, session and MFA checks to Task 4. Not covered here and logged: delegation, entitlement, Redis and Keycloak transports, all screens, IAM-003.
- **Type consistency:** `EffectiveAccess`, `Scope`, `GrantView` are defined once in Task 2 and used unchanged by Tasks 3, 4, 6, 7; `AuthzCache` is defined in Task 3 and consumed by Task 4; `SystemRole` is defined in Task 1 and consumed by Task 7; the result type of `checkGrant` is defined in Task 6 and used by the API commands.
- **Review Focus:** each line has a test: window edges and path-segment prefix (Tasks 2 and 3), failed moves leaving the tree intact and concurrent opposing moves (Task 5), broader permission patterns and unknown permission names (Task 6), stale `sv` and cache versioning (Tasks 3, 4 and 7).
