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
npm run e2e:walk -w @machvon/web       # route walk only (406 routes x 2 widths)
npm run e2e:visual -w @machvon/web     # visual cases only
node scripts/e2e-report.mjs            # summary of apps/web/e2e/report.json; exit 1 on a broken page or a failed case
node scripts/e2e-report.mjs --require-visual   # a pending visual case also fails
```

Environment: `E2E_ROUTES=HOME-01,ADM-01` limits the walk to those ids; `E2E_REQUIRE_VISUAL=1` makes a pending visual case
a failure (the final integration sets it); `E2E_PORT` fixes the dev server port; `E2E_BROWSER_CHANNEL` picks the browser.

## Reading the result

- `apps/web/e2e/report.json` (git-ignored) holds one entry per route and width with the console errors, the overflow and
  the problems found, and one entry per visual case with `pass`, `fail` or `pending`.
- A failed visual case writes a highlighted image to `apps/web/e2e/__diff__/<case>.diff.png`; the actual capture sits next to
  it. The 0.001 ratio is the target of the acceptance criterion: fix the markup or the CSS, never the target.
- `pending` means the thing to compare does not exist yet (an unimplemented screen, or no way to force a state): it is
  reported, never passed silently.

## How the baselines were captured

`Design/MACHVON_Design/work/export_screens.cjs`: viewport 1440 x 1000, device scale factor 1, the sidebar and `.studio` made
static, then a screenshot of the element `#screen-capture`. The web shell has the same element and the visual spec does the
same, so the sizes are comparable.

## Machine limits

The run is memory hungry next to PostgreSQL test servers. Run one browser run at a time, stop stray dev servers, and see
the note on orphaned `postgres.exe` processes before a full run.
