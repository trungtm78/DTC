# M2d Web Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React web application whose shell, tokens, states and first two screens (ADM-01 organisation tree, ADM-03 roles and grants) are the mockup in `Design/MACHVON_Design/02_Prototype` made real, talking to the M2b/M2c API through a typed client.

**Architecture:** `packages/design-tokens` turns `04_Design_Assets/design_tokens.json` into CSS variables and TypeScript tokens and validates tenant overlays; `packages/api-client` is a typed fetch client over the generated contract types that owns `Idempotency-Key`, `If-Match` and Problem+JSON handling; `apps/web` (React, Vite) imports the prototype's own CSS from the design package (never a copy), generates its route table from `navigation_architecture.json`, ports `workspace-navigation.js` to React components and implements the screens on top of the client. Server-state lives in TanStack Query; there is no global store.

**Tech Stack:** React 18, Vite, TypeScript strict, React Router, TanStack Query, Vitest with Testing Library and `@vitest/coverage-v8`, Playwright (Chromium) for route walks and visual regression, `pixelmatch` and `pngjs` for image diffs. Pin exact versions at least two weeks old (check `npm view <pkg> time --json`).

**Spec:** `Design/MACHVON_Design/03_Engineering/implementation_plan.json` stories ST-KERNEL-031, ST-KERNEL-111, ST-ADM-004 TK-4/6 (ADM-01 web and i18n), ST-ADM-005 TK-4/6 (ADM-03 web and i18n); `01_Documents/06_UI_UX_Design_System.md` (binding: D-B11, the mockup is the standard); `Design/MACHVON_Design/AGENTS.md`; `04_Design_Assets/design_tokens.json`, `04_Design_Assets/screens/ADM-01.png`, `ADM-03.png`, `04_Design_Assets/states/web-*.png`, `04_Design_Assets/navigation/*.png`; `03_Engineering/navigation_architecture.json`, `screen_catalog.json` (ADM-01, ADM-03 fields and rules); `Tenant_Theme_Specification.html`; `AUTONOMOUS_EXECUTION_PROTOCOL.md`.

**Out of scope for M2d (later plans, logged in PROGRESS.md):** real sign-in (OIDC code and PKCE against Keycloak, ST-IAM-002/-003, needs an environment): the web uses a development session provider that holds a signed test token and is compiled out of production builds; Flutter ThemeData generation and the mobile app (M2e); tenant theme editing screen (SAS-04) and the review/publish flow, only the overlay validation library is built here; the 404 other web screens (they render the generic "not implemented yet" fallback from the route table); PO approval of new visual baselines (only ADM-01 and ADM-03 and the shell are measured, against the existing baseline PNGs).

## Global Constraints

- All M2a to M2c constraints still apply (English code, no hard-coded UI strings, 90 percent patch coverage, strict TypeScript, no `TODO`/`@ts-ignore`/empty `catch`, Conventional Commits, no force push, pre-push gates, subagents never push).
- The mockup is binding (D-B11): the web reuses `02_Prototype/style.css`, `brand-theme.css`, `navigation.css`, `workspace-navigation.css`, `tenant-theme.css` through a Vite alias to the design package, so the design package stays the single source; markup classes follow `workspace-navigation.js`. New fields are added only to existing screens with the FR source named; no new visual language.
- i18n keys follow `module.screen.action.state` (for example `adm.orgUnit.create.submit`); catalogues `apps/web/src/i18n/vi.json` and `en.json`; Vietnamese is the default locale; a lint fails any string literal in JSX text or `aria-label`/`placeholder`/`title` props that is not a key lookup.
- Seven standard UI states on every screen: `default`, `loading`, `empty`, `error`, `denied`, `expired`, `offline`, rendered with the structure of `04_Design_Assets/states/web-*.png`.
- Viewports: 1440 x 1000 (web) and 390 x 844 (narrow check); no horizontal overflow at 1440; shell drawer below 980 px (`businessNavigation.mobileDrawerBreakpoint`), sidebar width 252 px (236 px compact).
- Tokens (Ruby / Porcelain): primary `#B4233D`, ink `#29272D`, background `#F7F5F4`, surface `#FFFFFF`, border `#E8E3E5`, selected `#FFF0F2`, font `Segoe UI, Arial, sans-serif` 14 px body and 27 px title, radii 8 / 14 / 20, spacing scale 4 8 12 16 20 24 32 48.
- Errors from the API are Problem+JSON; the UI shows `error.<code>.title` / `.detail` keys (the server already sends them) and never raw server text; `MFA_REQUIRED` opens the step-up prompt; `VERSION_CONFLICT` offers reload with the current version; `IDEMPOTENCY_IN_PROGRESS` retries after `Retry-After`.
- `apps/web` may import `@machvon/design-tokens`, `@machvon/api-client` and `@machvon/contracts` (types only); it must not import `@machvon/db` or `@machvon/kernel` (architecture rule extended in Task 1).

## Decisions taken without asking (also written to PROGRESS.md)

| Point | Decision | Basis |
|---|---|---|
| Web stack | React 18 + Vite + React Router + TanStack Query + Vitest | D-B07 (React/Vite); the rest is a convention choice |
| Prototype CSS | Imported from the design package by alias, not copied | AGENTS.md single deliverable, M2a principle |
| Development session | `DevSessionProvider` signs a test token with a key from `VITE_DEV_SESSION_KEY`, enabled only when `import.meta.env.DEV`; production build excludes it (checked by a bundle test) | real OIDC waits for Keycloak |
| Missing read operation for roles | The design has `get_resources_role_grant` but no read for role definitions, which the ADM-03 role picker needs. Add `get_resources_role_definition` (GET /resources/role_definition, permission `role_grant.read`) to `openapi.json` and `05_modules/ADM.md` through a change request entry so `design-check` and `baseline-preservation` stay green, and implement it | ADM-03 AC, AGENTS.md |
| As-of filter of ADM-01 | Client-side over the list (units carry `valid_from`/`valid_until`/`successor_id`); no new API parameter | schema has the fields |
| Visual baseline | Measure ADM-01, ADM-03 and the shell pages against the existing PNGs with `pixelmatch` (anti-aliasing ignored); target at most 0.1 percent of pixels per screen (AC-ST-KERNEL-031-1); the first measurement decides the work, the target is not lowered | TH05 |

## Review Focus

- A tenant theme text colour at 4.49:1 is rejected and at 4.5:1 accepted (boundary); an overlay containing `url(`, `expression(`, `@import`, a `<script>` or a non-hex colour is rejected whole, never partially applied.
- A route id that exists in `navigation_architecture.json` but has no implemented screen renders the fallback with the shell intact; an unknown URL renders the not-found state; both keep the sidebar and breadcrumb.
- Switching tenant in the dev session keeps breadcrumb, menu position and open form values (AC-ST-KERNEL-031-3): form state is held outside the theme provider so a theme swap never remounts the form.
- A double click on a submit button sends one command (same `Idempotency-Key` for a retry of the same attempt, a new key only for a new attempt); a lost response followed by retry returns the first result.
- A move that would create a cycle, a depth over 8 and a duplicate code show the server's error inline on the field named in the problem `detail` without losing the form; a `VERSION_CONFLICT` reloads the unit and keeps the user's edits visible for comparison.
- A user without `iam.unit.manage` sees ADM-01 read-only (no submit controls) and a user without `role_grant.read` sees the denied state, not an empty list.

---

### Task 1: Web workspace, i18n and lint rules (ST-KERNEL-111 foundation, TK-KERNEL-031-4)

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html,src/main.tsx,src/App.tsx,src/i18n/{index.ts,vi.json,en.json},src/test/setup.ts}`, `scripts/i18n-lint.mjs` and `scripts/i18n-lint.test.mjs`
- Modify: root `package.json` (workspace already matches `apps/*`; add scripts `i18n:check`, include in `lint`), `eslint.config.mjs` (React and hooks rules for `apps/web`), `.dependency-cruiser.cjs` and `scripts/architecture-check.mjs` (web import rule), `.github/workflows/ci.yml` only if a new system dependency is needed

**Interfaces:**
- Produces: `t(key: string, params?: Record<string, string | number>): string` and `useTranslation()` in `apps/web/src/i18n`; `type MessageKey` derived from `vi.json`; `i18nCheck(root): { missing: string[]; unused: string[]; badKeys: string[]; literals: string[] }`; rule: every key matches `/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){2,4}$/` and exists in both catalogues.

- [ ] **Step 1: Write failing tests**: `scripts/i18n-lint.test.mjs` on a scratch tree: a key missing from `en.json`, a key in JSX that is in no catalogue, a key that breaks the pattern, a hard-coded JSX text node and a hard-coded `aria-label` are each reported; a clean tree reports nothing; `apps/web/src/i18n/i18n.test.ts`: `t` falls back from a missing `en` key to `vi` and reports it through a dev warning hook, interpolation replaces `{name}`, unknown key returns the key itself in development and throws in tests; `scripts/architecture-check.test.mjs`: `apps/web` importing `@machvon/db` or `@machvon/kernel` is a violation, importing `@machvon/api-client` is not.
- [ ] **Step 2: Run** `node --test scripts/i18n-lint.test.mjs scripts/architecture-check.test.mjs` and `npm test -w @machvon/web`; expected FAIL.
- [ ] **Step 3: Implement** the workspace (Vite React TS template trimmed, strict `tsconfig` extending the base), the i18n module, the lint script (scan `apps/web/src/**/*.tsx` with the TypeScript compiler API, not regex) and the architecture rule; `npm run dev -w @machvon/web` serves a page that shows the localised app name.
- [ ] **Step 4: Run** `npm install && npm test && npm run lint && npm run typecheck && npm run architecture`; expected PASS, web coverage at least 90 percent.
- [ ] **Step 5: Commit** `feat(web): add web workspace, i18n catalogues and lint rules`.

### Task 2: Design tokens and tenant theme overlay (ST-KERNEL-031 web part)

**Files:**
- Create: `packages/design-tokens/{package.json,tsconfig.json,src/{index.ts,generate.ts,contrast.ts,overlay.ts},test/*.test.ts}`; generated `packages/design-tokens/src/tokens.generated.ts` and `packages/design-tokens/dist-css/tokens.css` (committed, checked by `tokens:check`)
- Modify: root `package.json` (scripts `tokens:generate`, `tokens:check`; add to `lint`), `scripts/architecture-check.mjs` (package is framework-free)

**Interfaces:**
- Produces: `generateTokens(json: DesignTokens): { css: string; ts: string }` (deterministic; CSS custom properties `--mv-color-primary`, `--mv-space-4`, `--mv-radius-card`, `--mv-font-body` …); `contrastRatio(foreground: string, background: string): number` (WCAG 2.x relative luminance, hex `#RGB`/`#RRGGBB`); `validateTenantOverlay(base: Tokens, overlay: unknown): { ok: true; tokens: Tokens; css: string } | { ok: false; findings: Finding[] }` where `Finding = { code: 'CONTRAST' | 'FORBIDDEN_VALUE' | 'UNKNOWN_TOKEN' | 'BAD_COLOR' | 'LOGO'; token?: string; ratio?: number }`; allowed overlay tokens are the colour tokens named in `Tenant_Theme_Specification.html` (read it and list them in a constant with a test that the constant matches the spec's table); text on surface and on primary must reach 4.5:1, large text 3:1.

- [ ] **Step 1: Write failing tests**: `generateTokens` output for the real `design_tokens.json` snapshot-free assertions (every colour, space step and radius present as a variable; running twice gives identical text); `contrastRatio('#000000','#FFFFFF') === 21`, white on white 1, the 3.2:1 theme of AC-ST-KERNEL-031-2 rejected with `CONTRAST` and ratio, 4.49 rejected, 4.5 accepted; overlay with `url(`, `expression(`, `@import`, `</style>`, `javascript:`, a named colour or `rgb()` is rejected whole with `FORBIDDEN_VALUE` or `BAD_COLOR` and `tokens` of the base are untouched; unknown token `UNKNOWN_TOKEN`; the base Ruby theme itself passes every contrast rule it declares (primary on surface, ink on background); `tokens:check` fails when a committed generated file is edited by hand.
- [ ] **Step 2: Run** `npm test -w @machvon/design-tokens`; expected FAIL.
- [ ] **Step 3: Implement** with no dependency beyond TypeScript; the generator reads `04_Design_Assets/design_tokens.json` by path.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture && npm run tokens:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(tokens): generate CSS and TypeScript tokens and validate tenant overlays`.

### Task 3: Typed API client (contract-first, ST-KERNEL-030 client part)

**Files:**
- Create: `packages/api-client/{package.json,tsconfig.json,src/{index.ts,client.ts,problem.ts,idempotency.ts,operations.ts},test/*.test.ts}`
- Modify: `packages/contracts/src/generate.ts` (emit `OPERATIONS` table: operationId to `{ method, path, versioned, stepUp, permission }`), regenerate `permissions.generated.ts` or a new `operations.generated.ts`, root `package.json`

**Interfaces:**
- Consumes: generated `paths`/`components` types from `@machvon/contracts`.
- Produces:
  ```ts
  interface ApiClientOptions { baseUrl: string; session: () => Promise<{ token: string } | undefined>; fetch?: typeof fetch; locale?: () => string; newKey?: () => string }
  class ApiError extends Error { readonly status: number; readonly code: string; readonly detail?: string; readonly correlationId: string; readonly extensions: Record<string, unknown>; readonly retryAfterSeconds?: number }
  function createApiClient(options: ApiClientOptions): { read<K extends ReadOperation>(operation: K, input?: ...): Promise<...>; command<K extends CommandOperation>(operation: K, input: { path?: ...; body: ...; ifMatchVersion?: number; attempt?: CommandAttempt }): Promise<CommandResultView> }
  interface CommandAttempt { readonly key: string }   // one per user intention; reused for retries of the same intention
  function newCommandAttempt(): CommandAttempt
  ```
  `command` sends `Idempotency-Key: attempt.key`, `If-Match: "<n>"` when the operation is versioned, `Content-Type: application/json`, an `X-Correlation-Id`; parses `application/problem+json` into `ApiError`; on 409 `IDEMPOTENCY_IN_PROGRESS` waits `Retry-After` seconds (capped at 10) and retries the same attempt up to 5 times; never retries other errors; `read` supports cursor pages through `readAll`.

- [ ] **Step 1: Write failing tests** with a fake `fetch`: headers sent for a versioned and an unversioned command (types make `ifMatchVersion` required exactly for versioned operations: a `// @ts-expect-error` test), same key reused by `attempt` across two calls, new key for a new attempt; Problem+JSON parsed (code, status, `current_version` extension, `Retry-After`); `IDEMPOTENCY_IN_PROGRESS` retried then succeeds and gives up after 5 with the error; 428 and 403 `MFA_REQUIRED` surface as `ApiError` without retry; non-JSON 502 becomes `ApiError` with code `INTERNAL_ERROR` and no body text exposed; the token is read per call (expiry-safe); `readAll` follows `next_cursor` until null and stops on an error.
- [ ] **Step 2: Run** `npm test -w @machvon/api-client`; expected FAIL.
- [ ] **Step 3: Implement** the client and the generator addition; `OPERATIONS` is the only place that knows methods and paths.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run architecture && npm run contracts:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(client): add typed API client with idempotent commands and Problem+JSON errors`.

### Task 4: Route table from `navigation_architecture.json` (ST-KERNEL-111 TK-2)

**Files:**
- Create: `apps/web/scripts/generate-routes.mjs` (+ test), `apps/web/src/routes/{routes.generated.ts,registry.ts,screens/index.ts,NotImplementedScreen.tsx,NotFound.tsx}`, tests
- Modify: `apps/web/package.json` (`routes:generate`, `routes:check`), root `lint`

**Interfaces:**
- Produces: `WEB_ROUTES: readonly { id: string; path: string; title: string; kind: string; area: string; module: string; group: string; role: string; parent: string | null }[]` (406 entries, `path = '/' + module.toLowerCase() + '/' + id.toLowerCase()`, unique, deterministic order); `screenModules: Record<string, () => Promise<{ default: ComponentType }>>` keyed by screen id for implemented screens (initially `ADM-01`, `ADM-03` added in Tasks 8 and 9); `resolveScreen(id): LazyExoticComponent`, falling back to `NotImplementedScreen` which shows the screen title, id, FR source from the route data and the standard `empty` state wording key `shell.screen.notImplemented.body`; `routes:check` fails when the committed file differs from regeneration.

- [ ] **Step 1: Write failing tests**: generator output has 406 routes, unique ids and paths, every `parent` exists, regeneration is byte-identical, a route with a changed title changes the output; `resolveScreen('HOME-01')` renders the fallback with the title; an unknown path renders `NotFound` with the shell; `routes:check` exits 1 on a hand-edited file.
- [ ] **Step 2: Run** the tests; expected FAIL.
- [ ] **Step 3: Implement** the generator (reads `03_Engineering/navigation_architecture.json`), the registry and the fallbacks.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run routes:check -w @machvon/web`; expected PASS.
- [ ] **Step 5: Commit** `feat(web): generate the route table from the navigation architecture`.

### Task 5: Shell, sidebar, breadcrumb, application library, states (ST-KERNEL-111 TK-1/3, seven UI states)

**Files:**
- Create: `apps/web/src/shell/{Shell.tsx,Sidebar.tsx,Breadcrumb.tsx,AppLibrary.tsx,TopBar.tsx,TenantSwitcher.tsx,favourites.ts,navigation-model.ts}`, `apps/web/src/states/{StateBoundary.tsx,states.css.ts}`, `apps/web/src/session/{DevSessionProvider.tsx,SessionContext.ts}`, `apps/web/src/theme/ThemeProvider.tsx`, tests, `apps/web/src/styles/prototype.css` (imports the five prototype stylesheets through the alias, in the prototype's order)
- Modify: `apps/web/vite.config.ts` (alias `@design` to `Design/MACHVON_Design`), `App.tsx` (router)

**Interfaces:**
- Consumes: Tasks 1 to 4; `workspace-navigation.js` (read it for class names, structure, favourites storage key, group rules) and `navigation_architecture.json` (`libraryGroups`, `modules`, `quickModules`, `contextualShortcuts`, `adminLibraryModules`).
- Produces: `buildNavigation(arch, routes, access): NavigationModel` (pure: areas, groups, quick shortcuts, contextual shortcuts for the active module, library listing with admin modules separated); `<Shell>` wrapping routes; `<StateBoundary state: ScreenState; onRetry?: () => void>` with `type ScreenState = 'default' | 'loading' | 'empty' | 'error' | 'denied' | 'expired' | 'offline'` and children rendered only for `default`; `useScreenState(queryResult): ScreenState` mapping `ApiError` codes (`SESSION_EXPIRED` to `expired`, 403 `SCOPE_DENIED` to `denied`, network failure to `offline`, empty page to `empty`); `ThemeProvider` applying a validated overlay from Task 2 on a wrapper element and exposing `{ themeId, themeVersion }`; `DevSessionProvider` (development only) with a tenant switch that changes the signed token's tenant.

- [ ] **Step 1: Write failing tests** (Testing Library): `buildNavigation` for the real architecture file gives the six library groups, the six quick shortcuts and the contextual shortcuts of `PRJ`; a route in `adminLibraryModules` is listed only under the admin group; the shell renders sidebar group, breadcrumb (`area / title`) and active item for ADM-01 and for an unimplemented screen; favourites persist across remounts through `localStorage` (wrapped in try/catch, works when storage throws); below 980 px the sidebar is a drawer (set `window.matchMedia` mock) and opens and closes with Escape and focus returns to the trigger; each of the seven states renders its wording key and role (`role="status"` for loading, `role="alert"` for error and denied); AC-ST-KERNEL-031-3: with two tenants having different overlays, switching tenant changes `themeId` and `themeVersion` while the breadcrumb text, the value typed into a form field and the sidebar scroll position are unchanged (the form lives outside `ThemeProvider`'s remount key); a rejected overlay keeps the previous theme and shows the `theme.overlay.rejected` notice.
- [ ] **Step 2: Run** `npm test -w @machvon/web`; expected FAIL.
- [ ] **Step 3: Implement** the pure model first, then components using the prototype's class names so `prototype.css` styles apply unchanged; all strings are keys added to both catalogues.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run i18n:check`; expected PASS.
- [ ] **Step 5: Commit** `feat(web): add the application shell, navigation model and standard UI states`.

### Task 6: Browser harness: route walk and visual regression (ST-KERNEL-111 TK-4, ST-KERNEL-031 TK-5)

**Files:**
- Create: `apps/web/e2e/{route-walk.spec.ts,visual.spec.ts,support/{diff.ts,server.ts}}`, `apps/web/playwright.config.ts`, `scripts/e2e-report.mjs` (summary JSON for evidence)
- Modify: `apps/web/package.json` (`e2e`, `e2e:visual`), `docs/runbooks/web-e2e.md`

**Interfaces:**
- Produces: `diffImages(actualPath: string, expectedPath: string, options?: { threshold?: number }): { differentPixels: number; totalPixels: number; ratio: number; diffPath: string }` (pixelmatch with anti-aliasing excluded); a route walk that opens every route of `WEB_ROUTES` at 1440 and 390 and records, per route: sidebar group present, breadcrumb present, active item, console errors, `document.documentElement.scrollWidth <= innerWidth` at 1440; a visual spec that screenshots `ADM-01`, `ADM-03`, the shell frame of one unimplemented screen and the seven state demos against `04_Design_Assets` PNGs.

- [ ] **Step 1: Write failing tests**: unit tests of `diffImages` (identical images ratio 0, one changed pixel above the threshold counted, differently sized images throw), the walk spec against a dev server (fails now: shell incomplete for ADM routes), the visual spec (fails now: screens absent).
- [ ] **Step 2: Run** `npm run e2e -w @machvon/web` after `npx playwright install chromium`; expected FAIL.
- [ ] **Step 3: Implement** the harness; the walk runs routes in 8 parallel pages with a hard per-page timeout of 15 s, produces `apps/web/e2e/report.json`, and fails with the list of broken route ids; baselines are the existing PNGs (1440 x 1000 clip); an actual image that differs is saved under `apps/web/e2e/__diff__/` (git-ignored).
- [ ] **Step 4: Run** the walk over all 406 routes (shell and fallback only at this point) and the unit tests; expected PASS for the walk and for `diffImages`; the visual spec stays pending until Tasks 8 and 9 and is then required.
- [ ] **Step 5: Commit** `test(web): add route walk and visual regression harness`.

### Task 7: Role definition read operation and ADM roles API gaps (ST-ADM-005 backend for ADM-03)

**Files:**
- Modify: `Design/MACHVON_Design/03_Engineering/openapi.json` (add `get_resources_role_definition` and `get_resources_role_definition_id` with schema `RoleDefinitionView`), `01_Documents/05_modules/ADM.md` (section 7 operation list), `03_Engineering/baseline_change_register.json` and `change_log.json` via the existing tools in `Design/MACHVON_Design/work/tools` (read `AGENTS.md` and the tools' README first), regenerate `packages/contracts` outputs
- Create: `apps/api/src/role-definitions.controller.ts`, `apps/api/test/role-definitions.test.ts`; extend `packages/db/src/role-store.ts` with `listRoles(tx, page)` and `getRole(tx, id)`
- Test: design gates (`node Design/MACHVON_Design/work/tools/src/check-cli.mjs`, baseline-preservation), isolation suite extension for the new id-bearing operation

**Interfaces:**
- Produces: `GET /resources/role_definition` (cursor page of `{ id, code, name_key, rank, permissions, is_system, guest_allowed, status, version }`, permission `role_grant.read`) and `GET /resources/role_definition/{id}`; both return only roles of the caller's tenant and, for callers without tenant-wide `iam.role.manage`, only roles the caller could grant (`rank` below their maximum rank in their scopes and permissions covered) so the ADM-03 role picker never lists a role the server would refuse.

- [ ] **Step 1: Write failing tests**: list returns the 14 seeded roles for a tenant owner and only grantable roles for a UNIT_ADMIN (never `TENANT_OWNER`, never a role carrying a permission the actor lacks); detail of a foreign tenant's role is 404 with no leak (add the operation to the isolation suite foreign-id cases and the negative matrix); `openapi` lint passes; design checks pass with the change-register entry; page cursor works.
- [ ] **Step 2: Run** the new tests and the design check; expected FAIL.
- [ ] **Step 3: Implement** the design edits in place (keep ids, no copies), the store methods and the controller (permission gate through the guard; scope filtering through `checkGrant` per role).
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run commands:check && npm run contracts:check` and the design check; expected PASS.
- [ ] **Step 5: Commit** `feat(api): add role definition reads for the role picker`.

### Task 8: ADM-01 organisation tree screen (ST-ADM-004 TK-4/6)

**Files:**
- Create: `apps/web/src/screens/adm/OrgTreeScreen.tsx`, `apps/web/src/screens/adm/org-tree/{tree-model.ts,UnitForm.tsx,UnitTree.tsx,MoveDialog.tsx,hooks.ts}`, i18n keys `adm.orgUnit.*`, tests
- Modify: `apps/web/src/routes/screens/index.ts` (register `ADM-01`)

**Interfaces:**
- Consumes: Tasks 3, 5; the client operations `get_resources_organization_unit`, `createOrganizationUnit`, `updateOrganizationUnit`, `moveOrganizationUnit`; the catalogue fields of ADM-01 (Đơn vị, Cấp cha, Ngày hiệu lực, Đơn vị kế thừa, Loại đơn vị, Mã ĐVHC, Là chủ đầu tư, Căn cứ pháp lý, Trạng thái).
- Produces: `buildUnitTree(units, asOf: string): TreeNode[]` (pure: parent links, depth, `dimmed` for units not valid at `asOf`, `successor` link for superseded units, children sorted by code); screen with tree on the left and the unit form on the right inside the mockup frame (card, title "Cây tổ chức", `Lưu phiên bản` action style), as-of date filter, create/update/move actions, inline server errors on the named field, read-only mode without `iam.unit.manage`.

- [ ] **Step 1: Write failing tests**: `buildUnitTree` with a 3-level tree and a superseded unit at two as-of dates (dimmed and successor link), orphan units (parent outside the reader's subtree) become roots, sorting stable; component tests with the fake client: create submits `OrgUnitCreate` with a fresh attempt key and shows the new unit, double click sends one request, `UNIT_CYCLE`/`UNIT_DEPTH_EXCEEDED`/`UNIT_CODE_TAKEN` are shown on the right fields without clearing the form, `VERSION_CONFLICT` reloads and keeps the edit visible, `MFA_REQUIRED` is not expected here (no step-up on these commands) but `denied` state shows for 403, `expired` for 401, empty tenant shows the empty state with a create call to action, loading skeleton, offline; keyboard: tree uses `role="tree"`/`treeitem` with arrow-key navigation and `aria-expanded`; every visible string is an i18n key (`i18n:check`); read-only mode hides submit controls.
- [ ] **Step 2: Run** `npm test -w @machvon/web -- adm`; expected FAIL.
- [ ] **Step 3: Implement** the pure model, then the components using prototype classes; TanStack Query keys `['org-units', tenantId]`, invalidated after each command.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run i18n:check` and the visual spec for ADM-01 (`npm run e2e:visual -w @machvon/web -- --grep ADM-01`): ratio at most 0.001 or fix CSS until it holds; expected PASS.
- [ ] **Step 5: Commit** `feat(web): add the ADM-01 organisation tree screen`.

### Task 9: ADM-03 roles and grants screen (ST-ADM-005 TK-4/6)

**Files:**
- Create: `apps/web/src/screens/adm/RolesGrantsScreen.tsx`, `apps/web/src/screens/adm/roles/{RoleList.tsx,RoleForm.tsx,GrantList.tsx,GrantDialog.tsx,StepUpPrompt.tsx,hooks.ts,permission-groups.ts}`, i18n keys `adm.roles.*`, tests
- Modify: `apps/web/src/routes/screens/index.ts` (register `ADM-03`)

**Interfaces:**
- Consumes: Tasks 3, 5, 7; operations `get_resources_role_definition`, `get_resources_role_grant`, `createCustomRole`, `updateCustomRole`, `grantRole`, `revokeRoleGrant`; the ADM-03 catalogue fields (Tài nguyên, Hành động, Phạm vi, Điều kiện, Mã vai trò, Hạng, Cho khách, Loại scope, Người cấp, Lý do).
- Produces: `groupPermissions(permissions: string[]): { resource: string; actions: string[] }[]` (pure: `a.b.c` becomes resource `a.b` and action `c`, patterns kept as such, `system.*` never listed); the screen with the role matrix (resource by action checkboxes) beside the preview card as in `ADM-03.png`, a grants table with revoke, a grant dialog whose role picker lists only roles from `get_resources_role_definition` and whose scope picker offers only kinds allowed for the recipient (guest: `CONTRACT` only); `StepUpPrompt` shown on 403 `MFA_REQUIRED` that reruns the same attempt after the session reports `aal2` (development session offers a "step-up" button).

- [ ] **Step 1: Write failing tests**: `groupPermissions` cases (patterns, duplicates, `system.*` dropped, stable order); the role picker never offers `TENANT_OWNER` to a UNIT_ADMIN fixture; a guest recipient limits the scope kinds to `CONTRACT` and the role list to `guest_allowed`; `grantRole` shows the step-up prompt on `MFA_REQUIRED` and succeeds on the retry with the same idempotency key; `ROLE_ESCALATION_DENIED`, `SELF_GRANT_DENIED`, `SCOPE_OUT_OF_GRANTOR_RANGE` and `SYSTEM_PERMISSION_NOT_GRANTABLE` show their keyed messages without losing the dialog; revoke requires a reason of at least 10 characters (client check mirrors the schema) and `If-Match` of the grant version; the seven states; read-only for AUDITOR-like fixtures; every string is a key.
- [ ] **Step 2: Run** `npm test -w @machvon/web -- roles`; expected FAIL.
- [ ] **Step 3: Implement** the pure grouping first, then the components.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck && npm run i18n:check` and the visual spec for ADM-03: ratio at most 0.001; expected PASS.
- [ ] **Step 5: Commit** `feat(web): add the ADM-03 roles and grants screen`.

### Task 10: End-to-end against the real API, then close M2d

**Files:**
- Create: `apps/web/e2e/adm-flows.spec.ts`, `apps/web/e2e/support/api-stack.ts` (starts embedded PostgreSQL, applies migrations, runs the Nest app with `AppModule.register({ policy })` and the test authentication guard, seeds two tenants and users through `authz-fixtures`)
- Modify: `PROGRESS.md`, `TODOS.md`, `docs/runbooks/web-e2e.md`

- [ ] **Step 1: Write failing flows** (Playwright, real browser, real API and database): tenant owner creates a unit, moves it under another, sees the tree update; a move creating a cycle shows the inline error; a UNIT_ADMIN restricted to a subtree cannot see other units (tree shows only the subtree) and grants a role inside the subtree but not above their rank (role picker hides it, a forced API attempt is refused and audited); step-up prompt flow on `grantRole`; tenant switch keeps breadcrumb and an unsaved form value while the theme changes; the route walk over all 406 routes at both widths has 0 console errors and 0 overflow at 1440.
- [ ] **Step 2: Run** `npm run e2e -w @machvon/web`; expected FAIL until the stack helper exists.
- [ ] **Step 3: Implement** the stack helper (reuse `startMigratedTestDatabase`, keep servers small: one PostgreSQL per run, stop it in `globalTeardown`, and clean its own orphans on start by pid file).
- [ ] **Step 4: Run** the full verification: `npm test && npm run lint && npm run typecheck && npm run architecture && npm run commands:check && npm run db:check && npm run contracts:check && npm run tokens:check && npm run i18n:check && npm run routes:check -w @machvon/web && npm run e2e -w @machvon/web && (cd ci && npm test)`; expected all PASS; record the e2e report numbers in PROGRESS.md.
- [ ] **Step 5: Review** with `/review` and the Codex review per commit (`codex review --commit <sha>`, in the background, one at a time on this machine), fix every finding with a regression test, repeat until clean; then `/plan-eng-review` of the whole of M2 against the original spec (milestone gate of the protocol): write mismatches to PROGRESS.md and fix them.
- [ ] **Step 6: Update PROGRESS.md** (M2d line, decisions, test counts, e2e numbers), commit `docs: record M2d completion`, push once with `run_in_background` after the gates pass, then write the M2e plan (Keycloak sign-in and tenant selection when an environment exists, SAS-001/002 registry and entitlement, NOT-001 notification core, mobile ThemeData) and record it as the next step.

## Parallel execution (maximum 5 agents)

Tasks 1, 2 and 3 are independent in files (web workspace, tokens package, client package) except the root `package.json`, `scripts/architecture-check.mjs` and `lint` script, which the integrating agent merges: run them in parallel, each agent adding its own root script lines to a patch note instead of editing the shared files, or take turns on those lines. Task 4 needs 1. Task 5 needs 1, 2, 3, 4. Task 6 needs 5 (and runs in parallel with Task 7, which is backend and design files only). Tasks 8 and 9 in parallel after 5, 6 and 7 (Task 9 needs 7). Task 10 last. Browser tests are memory-heavy: never run more than one Playwright run and one database suite at a time on this machine.

## Self-Review

- **Spec coverage:** KERNEL-111 AC-1 to Tasks 4, 5, 6 and 10 (406 routes, sidebar, breadcrumb, no console errors, no overflow at 1440); KERNEL-031 AC-1 to Tasks 2 and 6 (token generation and pixel threshold; the Flutter side is M2e), AC-2 to Task 2, AC-3 to Task 5; ADM-004 AC-3 to Task 8 (dimmed superseded units with successor link, seven states) and ADM-005 AC-7 to Task 9; ADM-004 and ADM-005 TK i18n to Tasks 8 and 9. Not covered here and logged: sign-in and tenant selection (IAM-002/-003), Flutter tokens, theme editing screen.
- **Type consistency:** `ScreenState` and `useScreenState` are defined once in Task 5 and used by Tasks 8 and 9; `ApiError`, `CommandAttempt` and `createApiClient` are defined in Task 3 and used by Tasks 5, 8, 9; `WEB_ROUTES` and `resolveScreen` in Task 4 are extended only by registering screens; `validateTenantOverlay` (Task 2) is the only entry for themes in Task 5.
- **Review Focus:** boundary 4.49 versus 4.5 and forbidden CSS (Task 2), fallback and not-found keep the shell (Tasks 4 and 5), tenant switch keeps form state (Task 5), double submit and retry keys (Tasks 3 and 8), inline server errors and conflict reload (Task 8), read-only and denied states (Tasks 8 and 9).
