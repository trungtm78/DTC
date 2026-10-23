# Web browser checks: route walk and visual regression

What it proves (ST-KERNEL-111 AC-1, ST-KERNEL-031 AC-1): every route of the generated route table renders the shell
(sidebar group, breadcrumb, active item) at 1440 px and 390 px with no console error and, at 1440 px, no horizontal
overflow; and the screens that exist match the baseline PNGs of `Design/MACHVON_Design/04_Design_Assets` within 0.1
percent of the pixels (anti-aliasing excluded).

## Prerequisites

- Google Chrome installed at `C:/Program Files/Google/Chrome/Application/chrome.exe` (the baselines were rendered with it, so
  it is the default engine), or Playwright's Chromium: `npx playwright install chromium` and
  `E2E_BROWSER_CHANNEL=` (empty) to use it. Browser binaries are never committed.
- `npm install` at the repository root. The runner starts the Vite dev server itself on a free port.

## Run

```bash
npm run e2e -w @machvon/web            # walk + visual
npm run e2e:walk -w @machvon/web       # route walk only (406 routes x 2 widths, 4 pages at a time)
npm run e2e:visual -w @machvon/web     # visual cases only
node scripts/e2e-report.mjs            # summary of apps/web/e2e/report.json; exit 1 on a broken page or a failed case
node scripts/e2e-report.mjs --require-visual   # a pending or stale visual case also fails
node scripts/e2e-report.mjs --require-walk     # a missing or stale route walk also fails
```

Environment: `E2E_ROUTES=HOME-01,ADM-01` limits the walk to those ids (an id that is not in the route table, or a selection that leaves no route, fails the run and clears the walk from the report); `E2E_REQUIRE_VISUAL=1` makes a pending visual case
a failure (the final integration sets it); `E2E_PORT` fixes the dev server port; `E2E_BROWSER_CHANNEL` picks the browser.

## Reading the result

- `apps/web/e2e/report.json` (git-ignored) holds one entry per route and width with the console errors, the overflow and
  the problems found, and one entry per visual case with `pass`, `fail` or `pending`.
- Every Playwright invocation has its own run id (`E2E_RUN_ID`, set by `playwright.config.ts`). Whatever an earlier run left in the report is marked `stale` (visual cases) or `stale: true` (the walk) as soon as a later run writes: it is listed, never counted as a pass, and `--require-visual` / `--require-walk` turn it into a failure. A visual test that throws or times out before it could record writes a `fail` entry (with the reason and the last URL) for every case it would have recorded, so an old pass cannot survive a broken run.
- A failed visual case writes a highlighted image to `apps/web/e2e/__diff__/<case>.diff.png`; the actual capture sits next to
  it. The 0.001 ratio is the target of the acceptance criterion: fix the markup or the CSS, never the target.
- `pending` means the thing to compare does not exist yet (an unimplemented screen, or no way to force a state): it is
  reported, never passed silently.

## How the baselines were captured

`Design/MACHVON_Design/work/export_screens.cjs`: viewport 1440 x 1000, device scale factor 1, the sidebar and `.studio` made
static, then a screenshot of the element `#screen-capture`. The web shell has the same element and the visual spec does the
same, so the sizes are comparable.

## Machine limits

The run is memory hungry next to PostgreSQL test servers. Run one browser run at a time and stop stray dev servers.

Before the API stack starts, `e2e/support/clean-orphans.ts` clears what an interrupted run of THIS workspace left behind, and nothing else:

- The stack runner of the pid file is stopped only if the process that now holds the pid is still that runner: its command line contains `serve.stack.ts` and it started before the pid file was written (a pid the system reused for another program, or a process started later, is never touched; its stale record is discarded).
- The leftover database servers are stopped only if they run a binary from this repository's `node_modules` and their data directory has the `machvon-e2e-pg-` prefix: another checkout's servers, and the servers of the other test suites (`machvon-pg-` prefix), are left alone.
- No server is stopped while the runner is still alive after the attempt to stop it.

## Visual regression of ADM-01 and ADM-03: what is compared

The mockup of these two screens is the generic prototype page (step cards for ADM-01, a placeholder matrix for ADM-03). The
application shows the real tree, form, role matrix and grants table instead, so the whole page cannot equal the baseline.
`e2e/visual.spec.ts` therefore gates, per screen, the regions below at the 0.001 ratio against the screen's own baseline PNG
(0 different pixels at the time of writing). A region is never moved or shrunk to make it pass: if one fails, the markup or
the CSS is fixed.

| Region | ADM-01 | ADM-03 | Why it must match |
|---|---|---|---|
| Sidebar (0,0 252x944) | yes | yes | shell frame; ADM-03's active item "Vai trò & quyền" |
| Top bar (252,0 1188x54) | yes | yes | shell frame; breadcrumb of the screen |
| Page heading (286,85 520x65) | yes | yes | title and subtitle position and typography |
| Card top-left (287,177 493x63) | yes | | card frame corner and the card title at the top of the card |
| Left card title (287,177 692x60) | | yes | two-column card frame |
| Right card title (999,177 407x60) | | yes | two-column card frame |
| Right card note (999,177 407x140) | | yes | title and the RBAC/ABAC callout (same wording as the mockup) |

Not compared, on purpose: the heading action buttons (the mockup's generic "Xuất" and "Lưu / Tiếp tục" are replaced by the
screen's real actions), everything inside the cards below their titles, the card heights, and the footer note (it follows the
content height and names the real data scope). The ratio of the whole page, or of its first rows when the real page is taller
than the baseline, is printed and attached to the test as an `informational` annotation, never as a pass criterion.

## Visual regression of NOT-01 and NOT-02: what is compared

The mockup of the notification inbox shows four sample notifications with their body text, project and time, and a preview
pane with the channel; the API (`listMyNotifications`) serves the title key, priority and read state only, so the content of
the cards is not compared. `e2e/visual.spec.ts` gates, at the 0.001 ratio against each screen's own baseline PNG:

| Region | NOT-01 | NOT-02 | Why it must match |
|---|---|---|---|
| Sidebar (0,0 252x944) | yes | yes | shell frame; the "Thông báo" group open, its unread badge (3 in the development session), and on NOT-02 the extra "Chi tiết thông báo" item |
| Top bar (252,0 1188x54) | yes | yes | shell frame; breadcrumb "Trung tâm thông báo / <screen>" |
| Page heading (286,85 520x65) | yes | | title and subtitle |
| Back link and heading (286,85 520x100) | | yes | the small back link above the title, the title and the subtitle |

Not compared, on purpose: the heading action buttons of the mockup ("Tùy chọn nhận tin", "Đánh dấu tất cả đã đọc", "Xuất",
"Chức năng liên quan": no operation stands behind them), the cards and the preview pane, and the footer note. The ratio of the
whole page is printed as an `informational` annotation.

## Visual regression of SAS-01, SAS-02, SAS-03 and SAS-25: what is compared

The mockups of the control-plane screens are the generic prototype page: a filter bar and four sample tenants (SAS-01, SAS-25),
and the same table for SAS-02 and SAS-03 under a back link (SAS-03 adds a row of tabs and two cards). The application shows the real registry rows, the creation form, the tenant with its lifecycle and the
entitlement table, so only the frame and the heading are compared. The four screens are opened as the system administrator
(`?devUser=sysAdmin`, a control-audience token; SAS-03 also names the fixture tenant of the stack, `&tenant=<id>`); the development fixture shows the platform workspace with the prototype's
sample name ("Cao Bằng") and user ("Nguyễn An"), so the frame equals the mockups. Gated at the 0.001 ratio against each
screen's own baseline PNG:

| Region | SAS-01 | SAS-02 | SAS-03 | SAS-25 | Why it must match |
|---|---|---|---|---|---|
| Sidebar (0,0 252x944) | yes | yes | yes | yes | shell frame; the "Nền tảng SaaS" group open with the active item (SAS-25 shows its own extra item) |
| Top bar (252,0 1188x54) | yes | yes | yes | yes | shell frame; breadcrumb "Nền tảng SaaS / <screen>" |
| Page heading (286,85 520x65) | yes | | | yes | title and subtitle |
| Back link and heading (286,85 520x100) | | yes | yes | | the small back link "← Danh sách tenant" above the title, the title and the subtitle |

Measured: every region has 0 different pixels except the SAS-02 and SAS-03 headings (9 of 52000, ratio 0.00017 each). Not compared, on purpose:
the heading buttons of the mockup ("Xuất", "Tạo mới", "Chức năng liên quan": no operation stands behind them; the real create link only exists for
a holder of `system.tenant.manage`), the tabs, the filter bar, the tables, the two cards of SAS-03 (the mockup's sample figures and chart against the real
tenant fields and its lifecycle) and the footer note. The ratio of the whole page is printed as
an `informational` annotation.

The browser flows of these screens are in `e2e/sas-flows.spec.ts`: they run against the real API stack with the saga behind
the outbox relay on mock infrastructure ports. Steps 6 to 11 of the provisioning are M2f, so a tenant created by the flow
stays `Provisioning` and its run stays `Running` at ENTITLEMENT_V1; the flow asserts exactly that, in the database and in the list.

## Visual regression of IAM-04 (tenant chooser): what is compared

The mockup of the chooser is three generic configuration cards ("Tenant", "Đơn vị", "Vai trò"); the application shows one card per
membership of the person, so the card names, pills and texts differ. The sidebar of the baseline lists one shortcut under the open
"Tài khoản & hỗ trợ" group (the prototype keeps only the shortcuts of screens it had), while `navigation_architecture.json`, the
single source of the navigation, lists four, so the rows between the active shortcut and the "Đã ghim" block differ by design data
and the sidebar is compared above and below them. Gated at the 0.001 ratio against the screen's own baseline PNG (the screen is
opened as the tenant owner of the development session):

| Region | IAM-04 | Measured | Why it must match |
|---|---|---|---|
| Sidebar top (0,0 252x582) | yes | 88 of 146664 pixels (0.0006) | tenant block, personal links, modules, the open group and its active shortcut |
| Sidebar foot (0,828 252x116) | yes | 0 | the administration link and the user card |
| Top bar (252,0 1188x54) | yes | 0 | breadcrumb "Tài khoản & hỗ trợ / Chọn tổ chức" |
| Page heading (286,85 520x65) | yes | 0 | title and subtitle |
| First card top (286,177 363x70) | yes | 0 | the card frame corner and its icon tile, above the card title |

The 88 pixels of the sidebar top are the 3 px accent bar that the tenant theme (`primary` key of the development tenant) draws on the
active shortcut and that the default-theme baseline does not have; NOT-02 shows the same effect on its extra item (0.00036). Not
compared, on purpose: the heading buttons of the mockup ("Xuất", "Lưu / Tiếp tục": choosing a tenant is done on each card), the cards
below their icon tile (names, state pills and notes are the person's own memberships), the sidebar rows between the two regions, and
the footer note. The ratio of the whole page is an `informational` annotation.

## Visual regression of IAM-09 (my effective access): what is compared

The mockup is the generic prototype page: a row of four tabs ("Tổng quan", "Số liệu", "Tải liệu", "Lịch sử"), a card with five label and
value rows and a chart, and a card of tasks. The application shows the real grants, scopes, permissions, delegations and plan benefits, and has
no tabs (no operation stands behind them), so its first card starts higher than the mockup's. Only the frame and the heading are compared, at
the 0.001 ratio against the screen's own baseline PNG (the screen is opened as the tenant owner of the development session, like IAM-04):

| Region | IAM-09 | Measured | Why it must match |
|---|---|---|---|
| Sidebar top (0,0 252x582) | yes | 0 of 146664 pixels | tenant block, personal links, modules, the open "Tài khoản & hỗ trợ" group and its active shortcut |
| Sidebar foot (0,828 252x116) | yes | 0 | the administration link and the user card |
| Top bar (252,0 1188x54) | yes | 0 | breadcrumb "Tài khoản & hỗ trợ / Phạm vi quyền hiệu lực của tôi" |
| Page heading (286,85 520x65) | yes | 0 | title and subtitle |

Not compared, on purpose: the heading buttons of the mockup ("Xuất", "Chức năng liên quan"), the tabs, everything inside and below the cards, and
the footer note. The ratio of the whole page (0.0205 at the time of writing) is an `informational` annotation.

## Real sign-in flows (IAM-04)

`e2e/session-flows.spec.ts` (`npm run e2e:session -w @machvon/web`) signs in through a real identity provider. The API stack
(`apps/api/test/e2e-stack/serve.stack.ts`) starts `E2eIdentityProvider` on `E2E_IDP_PORT` (chosen by `playwright.config.ts`, which also
gives the web application `VITE_OIDC_ISSUER`): realm discovery, a JWKS, an authorization endpoint that signs in the fixture user named
by `login_hint` (the first, the owner, by default; `acr_values=aal2` gives a second factor) and a token endpoint that enforces PKCE
S256, one use of a code, the client and the redirect address. Tenant tokens the API issues are verified by the production
`AuthGuard`; the development tokens of every other flow keep working side by side (a JWT with three parts goes to the real guard).
`?session=oidc` switches a development build to the provider for that browser tab.

The owner belongs to three tenants: Cao Bằng and Lào Cai (Active) and Hà Giang (Suspended for non-payment, a read-only session).
The flows: sign-in redirect, the chooser with its three cards, `MFA_REQUIRED` for the owner role and the second factor through the
provider, the tenant token of the chosen tenant on the API requests (`tid`, `mid`, `mode`, `acr`) and the session row at aal2;
the suspended tenant opens ADM-01 with its data and without the create control and with `mode = READ_ONLY`; a forged callback shows
the callback error and repeats nothing of the address.

## Why the walk is gentle on the machine

- The walk opens four pages at a time. With eight, Chrome fails healthy pages with `net::ERR_INSUFFICIENT_RESOURCES`, because the Vite dev server serves every module of a page as its own request.
- `vite.config.ts` scans every screen up front (`optimizeDeps.entries`), so the dev server never re-bundles dependencies and reloads the open pages in the middle of the walk.
- One browser run at a time on this machine: runs that share the repo take the lock directory `apps/web/e2e/.run-lock` (`mkdir` is atomic) and remove it when they end.
- Measured: 406 routes, 812 pages, 0 broken; the eight ADM flows pass; after a run no postgres or node process of the repository is left.

## SAS-04 tenant theme

The system administrator edits the draft of a tenant, sees it in a sandboxed frame, reviews the changes and publishes or restores a
version (`e2e/sas-flows.spec.ts`, "SAS-04 tenant theme"). Each flow makes a tenant of its own with version 1 of the theme (rows inserted
with the admin connection), so the theme of the three fixture tenants, which the other specs and the visual baseline read, is never
changed. The flows check the rows the screens wrote: the draft revision, the versions with their source and reason, the pointer, the audit
actions and the `sas.theme.published.v1` event; an expired review is made by moving `expires_at` into the past. The logo flow sends real
multipart uploads (a PNG, text that claims to be a PNG, a file of 1.5 MB). The API stack seeds version 1 of the three fixture tenants
(`seedThemes` in `serve.stack.ts`) so `getMyPublishedTheme` answers after a real sign-in, and `sysAdmin` carries `system.theme.manage`.
The visual case compares the shell frame, the heading, the note under it and the heads of the two cards with `SAS-04.png`
(ratio 0); the form below them is the application's own.

## DOC-07 signature verification

The visual case compares the shell frame and the heading with `DOC-07.png` (the heading region starts at the back link, like NOT-02). The mockup is
the generic review page; the application shows the six checks, the signatures table and the facts of the chosen version (`?version=<id>`), and
with no version a list of the PDF versions to pick one, so nothing below the heading is compared. Measured on the first run: sidebar 0.00037,
top bar 0, heading 0.00052 (whole page 0.0249, informational). No flow with data exists yet: verification needs a signed PDF in the file port, which
the API stack does not seed until the signing flow of Task 19 creates one.
