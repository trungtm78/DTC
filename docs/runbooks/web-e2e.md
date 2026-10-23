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

## Why the walk is gentle on the machine

- The walk opens four pages at a time. With eight, Chrome fails healthy pages with `net::ERR_INSUFFICIENT_RESOURCES`, because the Vite dev server serves every module of a page as its own request.
- `vite.config.ts` scans every screen up front (`optimizeDeps.entries`), so the dev server never re-bundles dependencies and reloads the open pages in the middle of the walk.
- One browser run at a time on this machine: runs that share the repo take the lock directory `apps/web/e2e/.run-lock` (`mkdir` is atomic) and remove it when they end.
- Measured: 406 routes, 812 pages, 0 broken; the eight ADM flows pass; after a run no postgres or node process of the repository is left.
