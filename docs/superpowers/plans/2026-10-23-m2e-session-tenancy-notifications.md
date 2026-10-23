# M2e Session, Tenancy and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can authenticate through an OIDC identity provider, choose a tenant and receive a tenant-scoped session whose access is bound to the database; a System Admin can register a tenant and run the infrastructure part of its provisioning; the tenant's entitlements gate commands; and domain events become in-app notifications that the user can read and acknowledge. The Flutter theme generator lands alongside.

**Architecture:** One control-plane database role (`machvon_control`) gets a small `ControlDatabase` handle (control tables directly, tenant tables only with `app.tenant_id` set, cross-tenant lookups only through narrow `SECURITY DEFINER` functions). Authentication is a port (`TokenVerifier`) with a JWKS/OIDC adapter and an in-process OIDC provider for tests; tenant tokens are issued behind a second port (`TenantTokenIssuer`). Provisioning is a saga runner over infrastructure ports (Keycloak admin, DNS and TLS, object storage, placement) that a Temporal runner can replace later. Entitlements are read through a cache keyed per tenant and cleared by an outbox consumer. Notifications are created by an outbox consumer built on the M2b `consumeOnce`.

**Tech Stack:** Same as M2d plus `jose` (JWT and JWKS), `ajv` (payload schemas of event types), Dart/Flutter (installed) for the mobile token package.

**Spec:** `Design/MACHVON_Design/03_Engineering/implementation_plan.json` stories ST-SAS-001 (steps 1 to 5 and screens SAS-01, SAS-02), ST-SAS-002 (SAS-25), ST-IAM-003 (IAM-04), ST-IAM-002 (backend port and adapter only), ST-NOT-001 (NOT-01, NOT-02), ST-KERNEL-031 (mobile part); `01_Documents/05_modules/{SAS,IAM,NOT}.md` (SAS 3.1, 3.6, 4, BR-SAS-01/02/10; IAM 3.1 to 3.4, BR-IAM-02/11/13; NOT 3.1, 3.2, BR-NOT-01/05); tables `tenant`, `placement`, `tenant_provisioning_run`, `product_plan_version`, `plan_feature`, `entitlement_version`, `subscription`, `usage_counter`, `user_account`, `membership`, `user_session`, `notification_instance`, `notification_event_type` in `schema_reference.sql`; `AUTONOMOUS_EXECUTION_PROTOCOL.md`.

## Environment findings (checked on this machine, 2026-10-23)

| Tool | Result | Consequence |
|---|---|---|
| Docker | not installed | no containers: Keycloak, Temporal, Redis, MinIO cannot run here |
| Java | OpenJDK 17.0.20.1 | Keycloak could be unpacked and started from a zip, but the repo has no infrastructure files and the CI runners cannot be assumed to; OIDC is built behind a port with an in-process provider; a real Keycloak run is an environment task (ST-KERNEL-042), not part of this plan |
| Flutter / Dart | Flutter 3.47.7, Dart 3.13.5 | the Flutter token package can be tested with `flutter test` locally; CI needs a Flutter setup step, so the mobile gate is optional (skipped when `flutter` is absent, reported as skipped like `product-tests` before the monorepo existed) |
| Repo infra | `.github/workflows/{ci.yml,release.yml}`, `ci/`, no Terraform, Helm or compose files | infrastructure as code (ST-KERNEL-011/-012/-015) stays out of this plan |

## Out of scope for M2e (logged in PROGRESS.md, planned in M2f)

Saga steps 6 to 11 (entitlement v1, license, role seed, root unit, theme v1, owner invite: ST-SAS-006), license issue and status job (ST-SAS-003), suspend/resume commands and the write-block guard (ST-SAS-004; M2e only carries the `READ_ONLY` mode claim and enforces it in the policy guard), tenant theme editing (ST-SAS-005), members and invitations (ST-ADM-006/-007; they depend on SAS-002 seats and IAM-003, and nothing in M2e needs them: tenants are seeded by tests), delegations, IAM-01/02/03 sign-in screens (they need a running Keycloak; the web uses redirect-based OIDC so no custom credential form is built), Redis and Temporal transports, SSE push to browsers (the push channel is a port with an in-process implementation), notification preferences, consents, templates, campaigns and every non-IN_APP channel (NOT-003 to NOT-017), the remaining R0 foundation stories (KERNEL-011..015, -040..045, -050, -051, -022 delivery tests, -024, -025, -027, IAM-005, ADM-003, -008, -009, DOC-001..005).

## Global Constraints

- All M2a to M2d constraints still apply (English code, no hard-coded UI strings with `module.screen.action.state` keys, 90 percent patch coverage, strict TypeScript, no `TODO`/`@ts-ignore`/empty `catch`, Conventional Commits, no force push, subagents never push, one Playwright or database suite at a time, migrations after V006 hand-written under `db/migrations`).
- Control plane (SAS 3.1, IAM 3.4): control-plane commands accept only tokens whose audience is `machvon-control`; they never run as `machvon_app`. Roles of control principals: `SystemAdmin` (all `system.*`), `PlatformOperator` (read only: `system.tenant.read`), `BillingOperator` (`system.billing.manage`, `system.tenant.read`), `SupportOperator` (`system.support.request`); they come from realm roles in the token, not from tenant grants.
- Tokens: tenant access token TTL 5 minutes with claims `sub`, `tid`, `mid`, `sv`, `sid`, `aud = machvon-api`, `acr`/`amr` giving `aal1` or `aal2`, and `mode` of `FULL` or `READ_ONLY`; identity token from the IdP carries `sub`, `email`, `aud` of the client; the database `scope_version` wins over `sv` (M2c).
- `selectTenantContext` (IAM 3.2) order of checks: membership belongs to the subject (403 `TENANT_SELECTION_INVALID`, never naming the owner), membership `Active` and inside `[valid_from, valid_until)` (403 `MEMBERSHIP_INACTIVE`), tenant `Active` or `Suspended` (other states 403 `TENANT_SUSPENDED`), MFA required by the membership's roles (403 `MFA_REQUIRED`); a Suspended tenant gives `mode = READ_ONLY`.
- Provisioning (SAS 3.1): tenant code `^[a-z][a-z0-9-]{2,30}$` unique forever (409 `TENANT_CODE_TAKEN`), region `vn-north` or `vn-south`, plan version must be `Published` (409 `PLAN_NOT_PUBLISHED`), placement `Active` with room (422 `PLACEMENT_UNAVAILABLE`); each step idempotent by its natural key; three retries with back-off 10 s, 1 min, 5 min then run `Failed`, tenant `Failed`, completed steps stay `DONE`; the retry command resumes at the failed step; compensation runs in reverse order and only on cancel.
- Entitlement (BR-SAS-10): `allowed(feature) = plan ⊕ active override`, with license mode `FULL`, grace behaviour, expired behaviour, `DENY` for suspended or revoked licenses (reads and exports excepted under `READ_ONLY_EXPORT`); STANDARD defaults: reporting ALLOW/READ_ONLY, export ALLOW/EXPORT_ONLY, `ai.analysis` DENY/DENY, `notification.campaign` DENY/DENY, `member.invite` DENY/DENY; every change writes a new `entitlement_version` (insert-only, `entitlements_hash = sha256(canonical features_json)`) and `sas.entitlement.changed.v1` in the same transaction; cache key `ent:{tenant}` with TTL 60 s and tenant prefix.
- Notifications (NOT 3.1): `dedupe_key = 'n1:' || hex(sha256(tenant_id || '|' || source_event_id || '|' || recipient_id || '|' || purpose))` (table CHECK `^n1:[0-9a-f]{64}$`), unique per tenant, insert with `ON CONFLICT DO NOTHING`; read is not acknowledge (BR-NOT-05); acknowledge on a notification that does not require it is 422 `ACK_NOT_REQUIRED`, on an expired one 409 `NOTIFICATION_EXPIRED`; a recipient without current read access to the resource sees "content unavailable" and nothing else.
- Error codes used exist in `error_codes.json` (checked: `TENANT_CODE_TAKEN`, `TENANT_STATE_INVALID`, `TENANT_SUSPENDED`, `TENANT_SELECTION_INVALID`, `MEMBERSHIP_INACTIVE`, `MFA_REQUIRED`, `ENTITLEMENT_DENIED`, `PLAN_NOT_PUBLISHED`, `PLACEMENT_UNAVAILABLE`, `ACK_NOT_REQUIRED`, `NOTIFICATION_EXPIRED`, `NOTIFICATION_STATE_INVALID`, `EVENT_TYPE_UNKNOWN`, `SESSION_EXPIRED`, `SCOPE_DENIED`, `VALIDATION_FAILED`, `RESOURCE_NOT_FOUND`); `PLACEMENT_FULL`, `PROVISIONING_FAILED` and `TENANT_NOT_FOUND` do not exist: use `PLACEMENT_UNAVAILABLE` and `RESOURCE_NOT_FOUND`, and keep run failure as data (`error_code` of the step) not as an HTTP code.

## Decisions taken without asking (also written to PROGRESS.md)

| Point | Decision | Basis |
|---|---|---|
| Real Keycloak not available | OIDC is a port: `TokenVerifier` with a `jose` JWKS adapter (discovery, `iss`, `aud`, `exp`, `nbf`, clock skew 30 s, key rotation by `kid`) tested against an in-process OIDC provider that signs real JWTs; no Keycloak-specific code beyond claim names | environment findings |
| Keycloak token exchange for `tid`/`mid`/`sv` | The API verifies the identity token and issues the tenant token itself through `TenantTokenIssuer` (ES256, key from an environment variable, `kid` in the header, rotation overlap by publishing two keys); a Keycloak exchange adapter can replace it later without changing callers | IAM 3.2 step 5 cannot be exercised without Keycloak; CR proposed |
| Cross-tenant membership lookup (`selectTenantContext`) | `SECURITY DEFINER` function `machvon.memberships_of_user(user_account_id uuid)` owned by `machvon_owner`, executable by `machvon_control` and `machvon_app`, returning only `(tenant_id, membership_id, status, valid_from, valid_until, membership_type, tenant_status, tenant_name)`; no RLS policy change | the design says "control plane lookup" but defines no mechanism; narrowest fix |
| Control-plane audit and idempotency before a tenant exists | `idempotency_record` and `audit_event` have `tenant_id NOT NULL` with RLS: control commands use the platform pseudo-tenant `00000000-0000-4000-8000-0000000000aa` for idempotency and for audit rows that are not about one tenant; `tenant.requested` and later lifecycle audit use the target tenant id | schema has no control-plane variants; CR proposed |
| Permission to feature mapping | `openapi.json` has no `x-feature`; a hand-written table `FEATURE_BY_PERMISSION` in `packages/contracts/src/features.ts` maps permissions to feature codes (reporting, export, ai.analysis, notification.campaign, member.invite) with a test that every key is a catalogue permission; CR proposed to add `x-feature` | BR-SAS-10 |
| `tenant_user_directory` view | named in IAM section 6 and absent from the schema: create it in the migration of Task 1 as `security_invoker` join of `membership` and `user_account` returning masked email and phone unless the caller holds `iam.member.read_pii` through a boolean column function `machvon.can_read_pii()` set by the transaction; record as design drift | IAM-003 TK-3 |
| Control principals | built from realm roles in the token by a static catalogue in the kernel (`controlAccessOf(roles)`), reusing `decide()` with audience `control` | SAS section 2 |
| Saga runner | `ProvisioningSaga` is a plain state-machine runner over step ports, started by an outbox consumer of `sas.tenant.requested.v1`; Temporal replaces the runner behind `WorkflowRunner` in ST-KERNEL-044; workflow id format `prov:{tenant_id}:{attempt}` is kept | no Temporal here |
| Tenant mode in the policy guard | the tenant token claim `mode = READ_ONLY` makes the guard refuse commands (non-GET) with 403 `TENANT_SUSPENDED` except operations marked export | SAS-004 AC-1 needs only this for M2e |
| Flutter task | included: a Node generator emits `machvon_theme.dart` (ThemeData, ColorScheme, text-scale rules), a Dart package tests it with `flutter test`, and contrast parity with the TypeScript validator is proven with shared test vectors; the Flutter gate is optional in CI | Flutter is installed; generator logic is pure |

## Review Focus

- A forged identity token (wrong `aud`, wrong `iss`, expired by 1 second beyond skew, `alg: none`, unknown `kid`, valid signature from another key) is refused 401 `SESSION_EXPIRED` and never reaches a membership lookup.
- `selectTenantContext` for a membership of another user and for a membership that does not exist give the same 403 `TENANT_SELECTION_INVALID` with the same body and similar latency; the response never names the other tenant.
- Two tabs selecting the same tenant get two sessions and two tokens; selecting another tenant revokes the previous token of that tab's session at once (deny-list) and the database row is `revoked_at`-stamped; a token minted before the revocation is rejected on the next request, not after its TTL.
- Provisioning a tenant code differing only in case or with trailing space, and the same code under a second key while the first is `Failed`, answers 409 `TENANT_CODE_TAKEN` and creates no second tenant; killing the saga runner between two steps and restarting it repeats no completed step and creates no second Keycloak organisation (port double counts calls).
- An entitlement change in tenant A leaves tenant B's cache keys and values untouched, and a command for a disabled feature is denied within 60 seconds of the change even with a warm cache; a risky command checks the database, not the cache.
- Event delivered three times (relay retry, consumer crash after insert) creates exactly one notification and counts two dedupe hits; a recipient whose membership ended or who lost read access between event and listing gets no content; acknowledge before read is refused.

---

### Task 1: Control-plane database access (ST-SAS-001 TK-1, ST-IAM-003 TK-1)

**Files:**
- Create: `db/migrations/V007__control_plane_access.sql`, `packages/db/src/control-database.ts`, `packages/db/src/user-session-store.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/control-plane-migration.test.ts`, `packages/db/test/control-database.test.ts`, `packages/db/test/user-session-store.test.ts`

**Interfaces:**
- Produces: grants for `machvon_control` on the control-plane tables (`tenant`, `placement`, `tenant_provisioning_run`, `product_plan_version`, `plan_feature`, `user_account`, `notification_event_type`, `tenant_domain` if present) and nothing on tenant tables except through the functions below and through transactions with `app.tenant_id` set (existing `tenant_boundary` policies apply); `machvon.memberships_of_user(uuid)` as in the decisions table; `machvon.tenant_runtime(tenant_id uuid)` returning `(status, access_policy)`; the view `tenant_user_directory`; `membership_invitation` and `user_session` untouched except grants already given to `machvon_app`.
  ```ts
  const PLATFORM_TENANT_ID = '00000000-0000-4000-8000-0000000000aa';
  class ControlDatabase {
    constructor(pool: Pool);                                         // pool connects as machvon_control
    withControl<T>(work: (tx: TenantTx) => Promise<T>): Promise<T>;  // one transaction, no tenant GUC
    withTenantOf<T>(tenantId: string, work: (tx: TenantTx) => Promise<T>): Promise<T>;  // sets app.tenant_id for tenant tables
  }
  interface SessionRecord { id: string; tenantId: string; membershipId: string; userAccountId: string; idpSessionId: string; assurance: 'aal1' | 'aal2' }
  class UserSessionStore {
    constructor(database: TenantDatabase);
    open(ctx: TenantContext, input: { userAccountId: string; idpSessionId: string; assurance: 'aal1' | 'aal2'; ipHash: string; userAgentSummary: string }): Promise<SessionRecord>;
    revoke(ctx: TenantContext, sessionId: string, reason: string): Promise<void>;
    isRevoked(ctx: TenantContext, sessionId: string): Promise<boolean>;
  }
  ```

- [ ] **Step 1: Write failing tests** (real PostgreSQL via `startMigratedTestDatabase`): `machvon_control` can read and write `tenant` and cannot read `organization_unit` directly (42501) but can through `withTenantOf` for a tenant it names; `machvon_app` still cannot read `tenant` or `user_account`; `memberships_of_user` returns only the caller-supplied user's rows across two tenants with the listed columns and leaks nothing else (column list asserted); `tenant_runtime` for an unknown id returns no row; the view masks email and phone for a transaction without the PII flag and shows them with it; `ControlDatabase.withTenantOf` rolls back and clears the GUC like `TenantDatabase` (reuse its tests' scenarios: pool leak after rollback, invalid tenant id rejected before a connection is taken); `UserSessionStore` opens, revokes and reports `isRevoked` per tenant, unique `(tenant, idp_session_id)` refuses a duplicate, tenant B cannot see tenant A's session.
- [ ] **Step 2: Run** `cd packages/db && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js test/control test/user-session`; expected FAIL.
- [ ] **Step 3: Write V007 and the three modules**; update the migration-list assertions in older tests only by name (they already assert by name since M2c).
- [ ] **Step 4: Run** `npm test -w @machvon/db && npm run db:check && npm run lint && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit** `feat(db): add control-plane access and the user session store`.

### Task 2: Kernel: control roles, entitlement function, feature mapping (ST-SAS-002 TK-2 pure part)

**Files:**
- Create: `packages/kernel/src/control-access.ts`, `packages/kernel/src/entitlement.ts`, `packages/contracts/src/features.ts`
- Modify: `packages/kernel/src/index.ts`, `packages/contracts/src/index.ts`
- Test: `packages/kernel/test/{control-access,entitlement}.test.ts`, `packages/kernel/test/entitlement.property.test.ts`, `packages/contracts/test/features.test.ts`

**Interfaces:**
- Produces: `CONTROL_ROLES: Readonly<Record<'SystemAdmin' | 'PlatformOperator' | 'BillingOperator' | 'SupportOperator', readonly string[]>>`; `controlAccessOf(roles: readonly string[], membershipId: string): EffectiveAccess` (one `TENANT`-scope grant per known role, unknown roles ignored, empty roles give an inactive access); `type LicenseMode = 'FULL' | 'GRACE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED'`; `interface FeatureEntry { featureCode: string; limitKind: 'BOOLEAN' | 'QUOTA' | 'METERED'; limitValue?: number; graceBehavior: 'ALLOW' | 'READ_ONLY' | 'DENY'; expiredBehavior: 'READ_ONLY' | 'EXPORT_ONLY' | 'DENY' }`; `interface Override { featureCode: string; enabled: boolean; limitValue?: number; validFrom: Date; validUntil: Date; status: string }`; `allowedFeature(input: { features: readonly FeatureEntry[]; overrides: readonly Override[]; licenseMode: LicenseMode; tenantPolicy: 'FULL' | 'READ_ONLY_EXPORT' | 'NO_ACCESS'; feature: string; operationKind: 'read' | 'write' | 'export'; now: Date }): { allowed: boolean; reason?: 'FEATURE_OFF' | 'LICENSE_GRACE' | 'LICENSE_EXPIRED' | 'LICENSE_SUSPENDED' | 'TENANT_POLICY' }`; `entitlementsHash(features: readonly FeatureEntry[]): string` (sha256 of `canonicalJson` sorted by feature code); in contracts `FEATURE_BY_PERMISSION: Readonly<Record<string, string>>` and `featureOf(permission: string): string | undefined`.

- [ ] **Step 1: Write failing tests**: `controlAccessOf(['PlatformOperator'])` holds `system.tenant.read` and not `system.tenant.manage`; `SystemAdmin` holds every `system.*` permission of the catalogue; the STANDARD defaults of Global Constraints (reporting write in grace is allowed or read-only per row, `ai.analysis` denied in every mode, `member.invite` denied); an Active override enables a feature for its window only (boundary: `validUntil === now` is over); an override in status `PendingApproval` or `Revoked` has no effect; `SUSPENDED` and `REVOKED` licenses deny writes and allow reads and exports only under `READ_ONLY_EXPORT`; `NO_ACCESS` denies everything; `entitlementsHash` is stable under reordering and changes with any limit; property: `allowedFeature` never allows a `write` when `licenseMode` is `EXPIRED` and the feature's expired behaviour is not `READ_ONLY`/`EXPORT_ONLY` handling write; every key of `FEATURE_BY_PERMISSION` exists in `PERMISSIONS`.
- [ ] **Step 2: Run** `npm test -w @machvon/kernel -- control-access entitlement` and `npm test -w @machvon/contracts -- features`; expected FAIL.
- [ ] **Step 3: Implement** the three modules (pure, no I/O).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture`; expected PASS.
- [ ] **Step 5: Commit** `feat(kernel): add control-plane roles and the entitlement function`.

### Task 3: Authentication port, OIDC adapter and tenant token issuer (ST-IAM-002 backend design)

**Files:**
- Create: `apps/api/src/auth/{token-verifier.ts,jwks-token-verifier.ts,tenant-token-issuer.ts,auth.guard.ts,auth.module.ts,claims.ts}`, `apps/api/test/auth/{oidc-test-provider.ts,token-verifier.contract.ts,jwks-token-verifier.test.ts,tenant-token-issuer.test.ts,auth-guard.test.ts}`
- Modify: root `package.json` (`jose`, exact version at least two weeks old), `apps/api/package.json`, `scripts/architecture-check.mjs` (only if the new dependency needs a rule)

**Interfaces:**
- Produces:
  ```ts
  interface VerifiedIdentity { subject: string; email?: string; emailVerified?: boolean; sessionId: string; assurance: 'aal1' | 'aal2'; aal2At?: Date; audience: 'tenant-client' | 'control-client'; roles: readonly string[] }
  interface TokenVerifier { verifyIdentity(token: string): Promise<VerifiedIdentity>; verifyTenantToken(token: string): Promise<VerifiedTenantToken> }
  interface VerifiedTenantToken { tenant: TenantContext; sessionId: string; assurance: 'aal1' | 'aal2'; aal2At?: Date; audience: 'tenant' | 'control'; mode: 'FULL' | 'READ_ONLY'; roles: readonly string[]; expiresAt: Date }
  interface TenantTokenIssuer { issue(input: { tenant: TenantContext; sessionId: string; assurance: 'aal1' | 'aal2'; aal2At?: Date; mode: 'FULL' | 'READ_ONLY'; now: Date }): Promise<{ accessToken: string; expiresInSeconds: number }>; publicKeys(): Promise<JsonWebKeySet> }
  class JwksTokenVerifier implements TokenVerifier                   // options: issuer, identityAudience, controlAudience, jwksUri or key resolver, clockSkewSeconds = 30, tenantTokenKeys
  class LocalTenantTokenIssuer implements TenantTokenIssuer          // ES256, `kid`, TTL 300 s, two keys during rotation
  class AuthGuard implements CanActivate                              // Bearer token -> request.tenantContext and request.principal (Principal of M2c), or 401 SESSION_EXPIRED
  ```
  `test/auth/oidc-test-provider.ts` starts an in-process HTTP server serving discovery and JWKS, signs identity tokens with RSA keys and can rotate keys, so adapter tests exercise real JWT verification. `token-verifier.contract.ts` is a shared suite (`runTokenVerifierContract(factory)`) that the test double and the JWKS adapter both pass.

- [ ] **Step 1: Write failing tests**: contract suite: valid tokens verify; refused with 401 `SESSION_EXPIRED` and no detail: wrong `iss`, wrong `aud`, expired beyond 30 s skew (accepted at 29 s past), `nbf` in the future beyond skew, `alg: none`, `HS256` signed with the public key (algorithm confusion), unknown `kid`, signature by another key, malformed segments, empty string, token of 10 000 characters; JWKS adapter only: key rotation (new `kid` appears, old one removed, cached set refreshes once on unknown `kid` and not more than once per 10 s), provider down uses the cached set until its max age then fails closed; `aal2` when `acr` or `amr` says MFA and `aal2At` from `auth_time`; `LocalTenantTokenIssuer` issues a token that `verifyTenantToken` accepts with `tid`, `mid`, `sv`, `sid`, `mode`, TTL 300 s, rejects a token signed by a rotated-out key after the overlap, and `publicKeys()` lists both keys during overlap; `AuthGuard` sets the principal for a control audience token with roles and for a tenant token, refuses a tenant token on a control route through the existing policy guard test (plane), and the `Authorization` header with a scheme other than `Bearer` is 401.
- [ ] **Step 2: Run** `cd apps/api && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js test/auth`; expected FAIL.
- [ ] **Step 3: Implement** with `jose`; keys for the issuer come from environment variables named in `.env.example` (add `TENANT_TOKEN_SIGNING_KEY_PEM_PATH`, `TENANT_TOKEN_KEY_ID`, `OIDC_ISSUER`, `OIDC_JWKS_URI`); no key material in the repository.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): add the token verifier port, OIDC adapter and tenant token issuer`.

### Task 4: selectTenantContext, session binding and revocation (ST-IAM-003 backend)

**Files:**
- Create: `apps/api/src/select-tenant.controller.ts`, `apps/api/src/select-tenant.service.ts`, `apps/api/src/identity.guard.ts`, `apps/api/src/user-session-deny-list.ts`, `apps/api/src/memberships.controller.ts`
- Modify: `apps/api/src/principal.ts` (`mode`), `apps/api/src/policy.guard.ts` (refuse non-export commands when `mode = READ_ONLY`: 403 `TENANT_SUSPENDED`), `apps/api/src/app.module.ts`
- Test: `apps/api/test/select-tenant.test.ts`, `apps/api/test/user-session-deny-list.test.ts`, `apps/api/test/memberships.test.ts`, extend `apps/api/test/policy-guard.test.ts`, extend the isolation suite and negative matrix for `selectTenantContext`

**Interfaces:**
- Consumes: Tasks 1 and 3; `IdempotencyStore`, `AuditWriter`.
- Produces: `POST /me/session/tenant-selection` (`selectTenantContext`, `session.self`) accepting an identity token (guarded by `IdentityGuard`, which yields `VerifiedIdentity` and the `user_account` found by `idp_subject`, 401 when none or when the account is `Locked`/`Disabled` with the neutral body), body `{ tenant_id, membership_id }` with `Idempotency-Key`, answering `200 { access_token, expires_in, tenant_id, membership_id, scope_version, mode }`; the service order is the Global Constraints order, uses `memberships_of_user`, takes the membership row `FOR UPDATE` under `withTenant`, reads the DB `scope_version`, opens a `user_session` (same `idp_session_id` per tenant), revokes the sessions the same IdP session holds in other tenants through `UserSessionStore.revoke` and `SessionDenyList`, writes audit `session.tenant_selected` (SUCCESS in the transaction, denials DENIED in a separate transaction), counts `tenant_selection_failures_total{code}`; `class UserSessionDenyList implements SessionDenyList` reading `user_session.revoked_at` through `UserSessionStore` behind a 5 second cache (well inside the 60 second SLO) and a local set for immediate revocation; `GET /resources/membership` and `/{id}` (`membership.read`) returning the DTO of the view `tenant_user_directory` with email and phone masked unless the caller holds the PII permission (use the permission that exists in the catalogue; if none exists record a design gap and gate on `iam.member.manage`).

- [ ] **Step 1: Write failing tests** (real database and app with `AuthGuard` and the OIDC test provider): AC-ST-IAM-003-1: another user's membership 403 `TENANT_SELECTION_INVALID` (identical body and status to a non-existent membership), a Suspended membership 403 `MEMBERSHIP_INACTIVE`, an expired validity window 403 `MEMBERSHIP_INACTIVE`, own Active membership 200 with a token that decodes to `tid`, `mid`, `sv` equal to the database value, `mode FULL`; Suspended tenant gives `READ_ONLY` and a command with that token is 403 `TENANT_SUSPENDED` while a GET is 200; a tenant in `Provisioning` is refused 403 `TENANT_SUSPENDED`; role requiring MFA with `aal1` identity is 403 `MFA_REQUIRED` and succeeds with `aal2`; AC-2: select tenant A then tenant B with the same IdP session: the first tenant token is refused 401 on the next request (deny-list) and `user_session.revoked_at` is set; same key and body replays the first response, same key with another body 409 `IDEMPOTENCY_CONFLICT`; a locked account and an unknown subject receive the same 401 body; forged or expired identity token never reaches the lookup (spy on the function call count); a token minted before a grant revocation fails with the database `scope_version` (M2c behaviour holds for tokens issued here); membership reads mask email and phone for a caller without the PII permission, and tenant B's memberships never appear; `selectTenantContext` added to the isolation suite and the negative matrix with the existing generators.
- [ ] **Step 2: Run** `cd apps/api && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js test/select-tenant test/user-session test/memberships`; expected FAIL.
- [ ] **Step 3: Implement** the service, guard, deny-list and controllers; the command is not run through `CommandInterceptor` because no tenant principal exists yet: it calls `IdempotencyStore.begin` under the target tenant context after membership validation and completes the record in the same transaction that opens the session.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): add tenant selection with session binding and revocation`.

### Task 5: Tenant registry and the provisioning saga, steps 1 to 5 (ST-SAS-001 backend)

**Files:**
- Create: `packages/db/src/tenant-registry.ts`, `apps/api/src/system-tenants.controller.ts`, `apps/api/src/provisioning/{saga.ts,steps.ts,ports.ts,workflow-runner.ts,provisioning.consumer.ts}`, `apps/api/test/provisioning/{fake-ports.ts,saga.test.ts,provisioning.consumer.test.ts}`, `apps/api/test/system-tenants.test.ts`
- Modify: `apps/api/src/app.module.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3 (`ControlDatabase`, `controlAccessOf`, `AuthGuard`), `consumeOnce`, outbox.
- Produces (db): `TenantRegistry` on `ControlDatabase`: `request(input: { code; name; region; planVersionId; requestedBy }): { tenantId; runId; created: boolean }` inserting `tenant` as `Requested`, `tenant_provisioning_run` attempt 1 `Running`, audit `tenant.requested` and outbox `sas.tenant.requested.v1` in one control transaction (a duplicate code raises `TENANT_CODE_TAKEN`, a plan not `Published` `PLAN_NOT_PUBLISHED`, no placement with room `PLACEMENT_UNAVAILABLE`), `get`, `list` (keyset), `startRun`, `recordStep`, `finishRun`, `markStatus` enforcing the SAS section 4 transition table (anything else raises `TENANT_STATE_INVALID`).
- Produces (api): ports `KeycloakAdminPort { ensureOrganization(alias: string): Promise<void>; removeOrganization(alias: string): Promise<void> }`, `DnsPort { ensureRecord(hostname: string): Promise<void>; removeRecord(hostname: string): Promise<void> }`, `AcmePort { ensureCertificate(hostname: string): Promise<void> }`, `ObjectStoragePort { ensurePrefix(prefix: string): Promise<void>; removeEmptyPrefix(prefix: string): Promise<void> }`, `PlacementPort { assign(tenantId: string, placementId: string): Promise<void>; release(tenantId: string): Promise<void> }` with MOCK implementations selected by configuration; `type ProvisioningStep = 'IDP_ORG' | 'DNS_SUBDOMAIN' | 'STORAGE_PREFIX' | 'DB_PLACEMENT' | 'RLS_SEED'`; `class ProvisioningSaga { constructor(registry, ports, options: { retryDelaysSeconds: [10, 60, 300]; delay: (seconds: number) => Promise<void> }); run(tenantId: string, attempt: number): Promise<'Succeeded' | 'Failed'>; compensate(tenantId: string, attempt: number): Promise<void> }`; `interface WorkflowRunner { start(workflowId: string, run: () => Promise<void>): Promise<void> }` with an in-process implementation; the RLS seed step runs the real isolation probe (a query under another tenant's context returns zero rows). Commands: `requestTenantProvisioning` (POST /system/tenants, 202 `{tenant_id, status, provisioning_run_id}`, `Idempotency-Key`), `retryTenantProvisioning` (versioned), reads `listSystemTenants` and `getSystemTenant`; all under audience `control`; the tenant-plane reads `get_resources_tenant*` stay unimplemented by design (SAS section 7 note).

- [ ] **Step 1: Write failing tests**: AC-ST-SAS-001-1 same key replays, same code under another key 409 `TENANT_CODE_TAKEN` (also for `ACME` versus `acme` and for a code of a `Failed` tenant), no second tenant row; code pattern violations 422; plan not Published 409; AC-2 a DNS port failing three times marks the DNS step `FAILED` with attempts 3, the run `Failed` at `DNS_SUBDOMAIN`, the tenant `Failed`, steps 1 to 3 `DONE` untouched, delays recorded as 10, 60, 300 seconds through the injected `delay`; `retryTenantProvisioning` creates attempt 2 starting at the failed step and calls no completed step's port again (call counters); a runner killed after step 2 (throw from a port) and restarted does not create a second organisation; `compensate` runs ports in reverse order for completed steps and leaves the tenant `Archived` only via `archiveTenant` (not implemented here: assert `TENANT_STATE_INVALID` for transitions outside the table: Active to Archived, Archived to anything, retry on Active); AC-3 `PlatformOperator` GET 200 and POST 403 with a DENIED audit row on the platform tenant, `SystemAdmin` POST 202, tenant-plane token on `/system/tenants` 403 `SCOPE_DENIED`; the saga runs from the outbox consumer exactly once for a redelivered `sas.tenant.requested.v1`; the new commands join the negative matrix and `commands:check`.
- [ ] **Step 2: Run** the new files (db and api, one process at a time); expected FAIL.
- [ ] **Step 3: Implement** the registry, ports with mocks, saga, runner, consumer and controller.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): add the tenant registry and the provisioning saga`.

### Task 6: Entitlements, cache and change propagation (ST-SAS-002 backend)

**Files:**
- Create: `db/migrations/V008__entitlements_seed.sql` (STANDARD plan seed), `packages/db/src/entitlement-store.ts`, `packages/db/src/entitlement-cache.ts`, `apps/api/src/entitlements.controller.ts`, `apps/api/src/entitlement-consumer.ts`, `apps/api/src/entitlement-push.ts`
- Modify: `apps/api/src/policy.module.ts` and `policy.guard.ts` (`entitled` built from the store and `FEATURE_BY_PERMISSION`), `packages/db/src/index.ts`
- Test: `packages/db/test/entitlement-store.test.ts`, `apps/api/test/entitlements.test.ts`, `apps/api/test/entitlement-consumer.test.ts`

**Interfaces:**
- Produces: V008 seeds one `Published` plan `STANDARD` revision 1 with the feature rows of Global Constraints and `member.seats` (QUOTA) and nothing else; `EntitlementStore { current(ctx): Promise<{ versionNo; hash; features: FeatureEntry[]; overrides: Override[]; licenseMode: LicenseMode; tenantPolicy }>; allowed(ctx, feature, operationKind, now): Promise<ReturnType<typeof allowedFeature>>; allowedFromDatabase(...) (same result, bypasses the cache, for risky commands); record(tx, input: { cause; planVersionId; features }): Promise<{ versionNo; hash }> (insert-only `entitlement_version` plus outbox `sas.entitlement.changed.v1` with `{ tenant_id, version_no, entitlements_hash }`, same transaction) }`; `EntitlementCache` port with in-memory implementation using `tenantKey('ent')`, TTL 60 s; `EntitlementChangedConsumer` (via `consumeOnce`) clearing `ent:{tenant}` and, through the M2c `AuthzCache`, `authz:{tenant}:*` entries, then calling `EntitlementPushPort.publish(tenantId, hash)` (in-process subscribers); `GET /me/entitlements` (`getMyEntitlements`) answering `{ version_no, entitlements_hash, features[] }` and `GET /system/tenants/{tenantId}/entitlements` (`getTenantEntitlements`, control plane); the guard denies with 403 `ENTITLEMENT_DENIED` and body detail `reason` (`FEATURE_OFF`, `LICENSE_GRACE`, ...) when `allowed` is false; license mode and tenant policy are read from the tenant's rows when they exist and default to `FULL` for tenants without a license (license issue is M2f).

- [ ] **Step 1: Write failing tests**: AC-ST-SAS-002-1 a recorded version 2 writes the outbox event in the same transaction (a rolled-back transaction writes neither version nor event), the consumer clears the cache key and `GET /me/entitlements` returns the new hash; AC-2 two tenants with warm caches: tenant A's change leaves tenant B's cache entries (keys and values) unchanged and every key carries the tenant prefix; `entitlement_version` is insert-only for the app role (UPDATE and DELETE refused); a command for a disabled feature (`member.invite` under STANDARD) is 403 `ENTITLEMENT_DENIED` with reason `FEATURE_OFF`; after enabling it by an override version the command is allowed within one cache TTL without restart and immediately for a risky command (database path); the guard never reads the cache for operations flagged risky (license, money, AI, campaign: define the flag list in `features.ts` with a test); `licenseMode GRACE` with `ALLOW` still allows; push port receives exactly one notification per change; `tenantPolicy READ_ONLY_EXPORT` allows GET and export, denies writes; AC-3 (quota fairness) is measured only as the rate-limit unit: a per-tenant limiter returns 429 `RATE_LIMIT` beyond its quota while another tenant's limiter is untouched (the p95 measurement stays an operations test in M2f).
- [ ] **Step 2: Run** the new files; expected FAIL.
- [ ] **Step 3: Implement** the store, cache, consumer, controller and guard wiring.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check && npm run contracts:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): add entitlements with a tenant-scoped cache and change propagation`.

### Task 7: Notification core (ST-NOT-001 backend)

**Files:**
- Create: `db/migrations/V009__notification_event_types.sql` (only if the seed of core event types is needed), `packages/db/src/notification-store.ts`, `apps/api/src/notifications/{consumer.ts,recipient-resolver.ts,dedupe.ts,payload-validator.ts,notifications.controller.ts,resource-access-port.ts}`, tests under `apps/api/test/notifications/` and `packages/db/test/notification-store.test.ts`
- Modify: root `package.json` (`ajv`, exact version at least two weeks old), `apps/api/src/app.module.ts`, `packages/db/src/index.ts`, `docs/notification-event-types.md` (registration guide for module owners, TK-NOT-001-6)

**Interfaces:**
- Produces: `dedupeKeyOf(input: { tenantId; sourceEventId; recipientId; purpose }): string` (`n1:` + sha256 hex as in Global Constraints); `PayloadValidator.validate(eventType: string, schemaVersion: number, payload: unknown)` using the `payload_schema` of `notification_event_type` (cached 60 s) and raising `EVENT_TYPE_UNKNOWN` for an unregistered type (the delivery is marked `DEAD` through the relay's normal failure path with the error class only); `RecipientResolver.resolve(tx, event, definition): Promise<string[]>` for the two definition kinds needed now (`explicit` membership ids and `role-in-scope` using `EffectiveAccessStore`/`scopeContains` on the event's resource reference), dropping memberships that are not `Active` or lack read access through `ResourceAccessPort { canRead(ctx: TenantContext, resource: { type: string; id: string }): Promise<boolean> }`; `NotificationConsumer.handle(delivery: OutboxDelivery)` calling `consumeOnce(database, delivery, 'notification', ...)`, inserting `notification_instance` rows (`status 'Delivered'` for `IN_APP`, `ack_required` and `priority` from the event definition, `expires_at = event_time + expires_after_minutes`) with `ON CONFLICT (tenant_id, dedupe_key) DO NOTHING` and counting `notification_created_total{event_type}` and `notification_dedupe_hits_total`; `NotificationStore { listFor(ctx, page), find(ctx, id), markRead(ctx, id), acknowledge(ctx, id, comment?) }`; commands and reads `listMyNotifications` (GET /me/notifications, keyset pagination, content re-rendered under current permissions: `{ id, state: 'available' | 'unavailable', title?, body?, deep_link?, priority, ack_required, read_at, acknowledged_at }` where unavailable carries no record data), `markNotificationRead` (POST, idempotent: the first read sets `read_at`, later reads keep it), `acknowledgeNotification` (requires a prior read, `ACK_NOT_REQUIRED` 422, `NOTIFICATION_EXPIRED` 409), and the operator reads `get_resources_notification_instance*` returning metadata only (no payload).

- [ ] **Step 1: Write failing tests**: AC-ST-NOT-001-1 event E-26 delivered three times (relay redelivery and a consumer crash between insert and commit, simulated with the M2b kill technique) yields exactly one row and `notification_dedupe_hits_total` 2; AC-2 a replay after the workflow version changed still yields one row because the key excludes template version and channel (assert two different `workflow_version_id` values); AC-3 read differs from acknowledged, acknowledge on a notification without `ack_required` is 422 `ACK_NOT_REQUIRED`, acknowledging before reading is refused (409 `NOTIFICATION_STATE_INVALID`), on an expired one 409 `NOTIFICATION_EXPIRED`; AC-4 after the recipient loses read access (grant revoked, `scope_version` bumped) the listing and the detail return `state: 'unavailable'` with no title, body or deep link; payload failing its schema is refused and no row exists; an event of a tenant never creates a row for another tenant's membership (cross-tenant recipient list ignored); a recipient whose membership is `Suspended` gets nothing (log counter `suppressed_no_access`); `dedupeKeyOf` is stable and differs per recipient and per purpose; negative matrix and isolation cases for the three notification commands and the metadata reads.
- [ ] **Step 2: Run** the new files; expected FAIL.
- [ ] **Step 3: Implement** the store, consumer, resolver, validator, controller and the registration guide.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(api): add the notification core with dedupe, inbox, read and acknowledge`.

### Task 8: Web session: OIDC client, tenant chooser IAM-04

**Files:**
- Create: `apps/web/src/session/{oidc/pkce.ts,oidc/OidcSessionProvider.tsx,oidc/callback.tsx,tenant-token.ts}`, `apps/web/src/screens/iam/TenantChooserScreen.tsx`, `apps/web/src/screens/iam/tenant-chooser/*`, i18n keys `iam.tenantChooser.*` and `session.oidc.*`, tests, e2e flow
- Modify: `apps/web/src/session/SessionContext.ts` (additive: `identity`, `tenantToken`, `mode`), `apps/web/src/routes/screens/index.ts`, `apps/web/e2e/support/*` (the stack starts the OIDC test provider and the API with `AuthGuard`)

**Interfaces:**
- Consumes: Tasks 3 and 4, M2d session and client.
- Produces: `createPkcePair(random?: () => Uint8Array): Promise<{ verifier: string; challenge: string }>` (S256, 43 to 128 characters, base64url without padding, RFC 7636 test vector); `OidcSessionProvider` (redirect to the authorization endpoint with `state` and `nonce` kept in `sessionStorage` inside try/catch, callback exchange of the code, silent renewal of the 5-minute tenant token one minute before expiry, `signOut`); `<TenantChooserScreen>` for `IAM-04`: card list of the user's memberships (from a `GET` of the memberships the identity may select: the API exposes them through `selectTenantContext` candidates, so add `GET /me/memberships` only if the design lists none; the design lists `get_resources_membership` which is tenant-scoped, therefore the chooser takes its list from `memberships_of_user` through `GET /me/session/tenant-selection/candidates`: record as design gap and add it to `openapi.json` by change request in this task), showing membership type and tenant state, warning badge and read-only note for Suspended tenants, one click calls `selectTenantContext` with one attempt key per intention, MFA prompt on 403 `MFA_REQUIRED`, seven states.

- [ ] **Step 1: Write failing tests**: PKCE against the RFC 7636 appendix B vector; callback with a wrong `state` or a replayed code shows the `session.oidc.callback.error` state and stores no token; renewal replaces the token without remounting the shell (form state kept: reuse the M2d tenant-switch test shape); the chooser lists three memberships including one Suspended (badge and `READ_ONLY` note), selecting a tenant calls the client once on double click, the old tenant token is dropped after a switch (the next request uses the new token), `MFA_REQUIRED` opens the existing step-up prompt and retries the same attempt, `denied`/`expired`/`offline`/`empty` states; every string is a key; e2e: with the OIDC test provider the browser signs in, chooses a tenant and lands on ADM-01 with the tenant token (assert the request header), and an `READ_ONLY` tenant shows no submit controls.
- [ ] **Step 2: Run** `npm test -w @machvon/web -- session iam`; expected FAIL.
- [ ] **Step 3: Implement** the PKCE module, provider, callback route and the chooser; the development session provider stays for development builds only.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run i18n:check && npm run build -w @machvon/web`; then one Playwright run of the new flow; expected PASS; visual target for the chooser against `04_Design_Assets/screens/IAM-04.png`: shell frame regions 0, page regions at most 0.001 as documented per screen in `docs/runbooks/web-e2e.md`.
- [ ] **Step 5: Commit** `feat(web): add OIDC sign-in and the tenant chooser`.

### Task 9: Web screens NOT-01 and NOT-02

**Files:**
- Create: `apps/web/src/screens/not/{InboxScreen.tsx,NotificationDetailScreen.tsx,inbox/*}`, i18n keys `not.inbox.*` and `not.detail.*`, tests
- Modify: `apps/web/src/routes/screens/index.ts`, `apps/web/src/shell/*` only for the unread badge source (`SessionUser.unreadNotifications` replaced by a query of the inbox count when a real session exists)

**Interfaces:**
- Consumes: Task 7 operations and the M2d client, `StateBoundary`.
- Produces: `NOT-01` inbox (list with badges "needs acknowledgement" and "unread" visually distinct, filters unread/all, keyset paging), `NOT-02` detail (opens `markNotificationRead` once on view, acknowledge button with optional comment when `ack_required`, "content unavailable" state when `state = unavailable` showing nothing about the record), deep links to the source screen only when available.

- [ ] **Step 1: Write failing tests**: badges differ and have distinct accessible names; opening detail marks read once (not on re-render); acknowledge button only for `ack_required`, disabled until read, shows `ACK_NOT_REQUIRED`/`NOTIFICATION_EXPIRED` keyed messages; unavailable notification renders the unavailable state and no title or body anywhere in the DOM; the seven states; keyboard navigation of the list; unread count in the shell follows the list after reading; strings are keys.
- [ ] **Step 2: Run** `npm test -w @machvon/web -- not`; expected FAIL.
- [ ] **Step 3: Implement** the two screens.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run i18n:check`, then one Playwright visual run of NOT-01 and NOT-02 against their PNGs; expected PASS under the same regional rule as Task 8.
- [ ] **Step 5: Commit** `feat(web): add the notification inbox and detail screens`.

### Task 10: Web screens SAS-01, SAS-02 and SAS-25

**Files:**
- Create: `apps/web/src/screens/sas/{TenantListScreen.tsx,TenantCreateScreen.tsx,EntitlementsScreen.tsx,tenants/*}`, i18n keys `sas.tenants.*`, `sas.tenantCreate.*`, `sas.entitlements.*`, tests
- Modify: `apps/web/src/routes/screens/index.ts`, dev session users (a SystemAdmin and a PlatformOperator with audience `control`), `apps/web/e2e/support/*`

**Interfaces:**
- Consumes: Tasks 5 and 6 operations (`listSystemTenants`, `requestTenantProvisioning`, `getSystemTenant`, `getMyEntitlements`/`getTenantEntitlements`).
- Produces: `SAS-01` tenant list (status badges for the seven states, run status and current step, keyset paging, filter by status), `SAS-02` creation form (code with the BR-SAS-01 pattern checked client-side and server errors on the field, name, region, plan version, 202 result shown with a link to the run), a retry action for `Failed` tenants (versioned, one attempt key), read-only for `PlatformOperator` (controls hidden), `SAS-25` read-only effective entitlement table with the current hash for the tenant plane (`getMyEntitlements`) and for the control plane per tenant.

- [ ] **Step 1: Write failing tests**: list renders each of the seven statuses with distinct accessible labels; the form refuses a bad code before sending and shows `TENANT_CODE_TAKEN` on the code field without clearing the form; double submit sends one request; `PlatformOperator` sees no create or retry controls; `Failed` tenant shows the failed step and a retry that replays one attempt on double click; `SAS-25` shows the hash and the rows (feature, allowed, limit, license behaviour) and changes when the entitlement query is invalidated by the (in-process) push port; seven states; strings are keys.
- [ ] **Step 2: Run** `npm test -w @machvon/web -- sas`; expected FAIL.
- [ ] **Step 3: Implement** the three screens.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run i18n:check`, then one Playwright run: a SystemAdmin creates a tenant against the real stack with MOCK ports and sees it move to `Active` is not expected (steps 6 to 11 are M2f): assert the tenant reaches the state the saga leaves it in after step 5 (document it: provisioning stays `Provisioning` until M2f; the list shows run status `Running` at `ENTITLEMENT_V1`), plus the visual regions for SAS-01, SAS-02, SAS-25; expected PASS.
- [ ] **Step 5: Commit** `feat(web): add the control-plane tenant screens and the entitlement view`.

### Task 11: Flutter ThemeData generator (ST-KERNEL-031 mobile part)

**Files:**
- Create: `packages/design-tokens/src/dart.ts`, `packages/design-tokens/test/dart.test.ts`, `packages/design-tokens/test/vectors/contrast-vectors.json`, `packages/mobile-tokens/{pubspec.yaml,lib/machvon_tokens.dart,lib/machvon_theme.generated.dart,lib/contrast.dart,test/theme_test.dart,test/contrast_test.dart,analysis_options.yaml}`
- Modify: `packages/design-tokens/package.json` (script `tokens:generate` also writes the Dart file; `tokens:check` compares it), root `package.json` (`mobile:test` script that runs `flutter test` in `packages/mobile-tokens` and exits 0 with a "skipped" line when `flutter` is not on the PATH), `ci/src/verify.mjs` and `ci/config.json` (stage `mobile-tests`, optional like the earliest `product-tests`: skipped when Flutter is absent, never counted as pass), `.github/workflows/ci.yml` (Flutter setup step with a pinned version)

**Interfaces:**
- Produces: `generateDart(json: DesignTokens): string` (deterministic Dart source: `const Color`s, spacing and radius constants, `ThemeData machvonTheme()` with `ColorScheme.light(primary, onPrimary, surface, onSurface, error, ...)`, `TextTheme` using body 16 and title 27 for mobile per `font.mobileBody`, minimum touch target 44 pt iOS and 48 dp Android as `MaterialTapTargetSize` plus constants, `Segoe UI` fallback family list), Dart `double contrastRatio(Color a, Color b)` and `bool overlayAccepted(Map<String, String> overlay)` mirroring the TypeScript rules; shared vectors file generated by a Node script from the TypeScript implementation (inputs and expected ratios rounded to two decimals, including the 3.2:1 rejection and the 4.5:1 boundary).

- [ ] **Step 1: Write failing tests**: Node: generated Dart text is byte-identical on two runs, contains every colour token as an uppercase `0xFFRRGGBB` literal and the mobile font and touch constants, `tokens:check` fails when the committed Dart file is edited; Dart: `machvonTheme().colorScheme.primary` equals `#B4233D`, body text style size 16, title 27, the theme passes the same contrast pairs as the web (`primary` on surface at least 4.5), `contrastRatio` matches every shared vector within 0.01, the 3.2:1 overlay is rejected and 4.5:1 accepted, forbidden values (`url(`, `javascript:`, named colours) rejected.
- [ ] **Step 2: Run** `npm test -w @machvon/design-tokens` and `cd packages/mobile-tokens && flutter test`; expected FAIL.
- [ ] **Step 3: Implement** the generator, the Dart package and the optional CI stage (with `ci/test/verify.test.mjs` cases: stage skipped when `flutter` is missing, failing when `flutter test` fails).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run tokens:check && npm run mobile:test && (cd ci && npm test)`; expected PASS locally with Flutter installed.
- [ ] **Step 5: Commit** `feat(tokens): generate the Flutter theme from the design tokens`.

### Task 12: Close M2e (verification, review, PROGRESS, push, M2f plan)

**Files:**
- Modify: `PROGRESS.md`, `TODOS.md` (carry-overs: change requests for `x-feature`, candidates endpoint, token exchange, control-plane idempotency and audit placement, `tenant_user_directory`; the M2f scope list above)

- [ ] **Step 1: Run** the full verification: `npm test && npm run lint && npm run typecheck && npm run architecture && npm run commands:check && npm run db:check && npm run contracts:check && npm run tokens:check && npm run i18n:check && npm run routes:check -w @machvon/web && npm run mobile:test && npm run e2e -w @machvon/web && (cd ci && npm test)`; record the numbers.
- [ ] **Step 2: Review** with `/review` and Codex per commit (`codex review --commit <sha>`, one at a time in the background, never two Playwright or database suites at once); fix every finding with a regression test; repeat until clean.
- [ ] **Step 3: Milestone gate** of the protocol (`/plan-eng-review`): compare M2a to M2e with the original spec (`implementation_plan.json` R0 stories, IAM, SAS, NOT module docs); write mismatches and the remaining R0 list into `PROGRESS.md`.
- [ ] **Step 4: Update PROGRESS.md** (M2e line, decisions table, test counts), commit `docs: record M2e completion`, push once with `run_in_background`, then write the M2f plan from the carry-over list (SAS-003/-004/-005/-006 licence, lifecycle, theme and the remaining saga steps, ADM-006/-007, IAM-005, audit/outbox read endpoints, first slices of R1) and record it as the next step.

## Parallel execution (maximum 5 agents)

Task 1 first. Then in parallel: Task 2 (kernel and contracts files), Task 3 (auth files), Task 11 (design-tokens, mobile package, CI stage; independent of everything else). After Task 1 and Task 3: Task 4. After Task 1 and Task 2: Task 5, Task 6 and Task 7 in parallel (disjoint files except `apps/api/src/app.module.ts`, `packages/db/src/index.ts` and the isolation suite and negative matrix, which the integrating agent merges). Task 8 after Task 4; Task 9 after Task 7; Task 10 after Tasks 5 and 6; Tasks 8, 9, 10 in parallel but their Playwright runs one at a time (a lock file under `apps/web/e2e/.lock`). Task 12 last. Database suites are memory heavy: no more than two agents running database tests at the same moment.

## Self-Review

- **Spec coverage:** SAS-001 AC-1 to AC-3 to Task 5, AC-4 and AC-5 (screens) to Task 10; SAS-002 AC-1 and AC-2 to Task 6, AC-3 (p95 measurement) only as the limiter unit, the measurement itself is an operations test in M2f; IAM-003 AC-1 and AC-2 to Task 4, AC-3 (screen) to Task 8; IAM-002 backend (port, adapter, token model) to Task 3, AC-1/-2/-4/-5 need Keycloak and are out of scope, recorded; NOT-001 AC-1 to AC-4 to Task 7, AC-5 and AC-6 (screens) to Task 9; KERNEL-031 mobile part to Task 11. Not covered and logged: everything under "Out of scope".
- **Type consistency:** `ControlDatabase` and `PLATFORM_TENANT_ID` (Task 1) are used by Tasks 4, 5, 6; `VerifiedIdentity`, `TokenVerifier`, `TenantTokenIssuer` (Task 3) are used by Task 4 and the web provider of Task 8; `FeatureEntry`, `allowedFeature`, `entitlementsHash` (Task 2) are used by Task 6; `OutboxDelivery` and `consumeOnce` are the M2b signatures; `Principal.mode` is added once in Task 4 and read by the policy guard.
- **Review Focus:** forged tokens (Task 3), uniform tenant-selection errors and session revocation (Task 4), duplicate codes and saga restarts (Task 5), tenant-scoped cache and risky-command database path (Task 6), triple delivery and lost access (Task 7).
- **Design gaps needing change requests (recorded in TODOS.md at close):** no `x-feature` on operations; no cross-tenant membership lookup mechanism; no control-plane variants of idempotency and audit; `tenant_user_directory` view missing from the schema; candidate-membership read for the tenant chooser missing from `openapi.json`; Keycloak token exchange replaced by an API-issued tenant token.
