# R10 baseline approvals: screens whose real UI differs from the mockup

Status: waiting for the product owner. Measured on 2026-10-23 at commit `99da8f8` with the browser lane
(`npm run test:lane -- browser npm run e2e:visual -w @machvon/web`, Google Chrome on Windows, the engine of the baselines).

## Why this document exists

D-B11 makes the mockup (`Design/MACHVON_Design/04_Design_Assets/screens/<ID>.png`) binding. The process for a screen
whose real UI shows more or other than the mockup is R10 (`01_Documents/06_UI_UX_Design_System.md`, "Quy trình thêm màn
hình và field mới", steps 8 and 9): the real screen is drawn into the prototype and `screen_catalog.json`, the product owner (PO)
approves the new image, and only then does it become the visual-regression baseline that gates the whole page.

None of the screens below has been through step 9(c). They are built to the mockup's frame, tokens, components and
seven states, but their content is the real data, so the whole page cannot equal the mockup. Until the PO decides:

- the baseline PNGs stay as they are (nothing here edits or replaces a baseline);
- only the regions listed below are gated, each at the ratio 0.001 against the screen's own baseline PNG, and none was ever
  moved or shrunk to pass (`docs/runbooks/web-e2e.md`);
- the ratio of the whole page is measured on every run and printed as an `informational` annotation, never as a pass
  criterion. It is far above the 0.001 target on every screen (0.9 to 4.3 percent), which is the reason for this decision.

## Screens that differ from the mockup

Whole page = share of different pixels over the rows that the real page and the baseline share (target 0.001 = 0.1 percent).
Gated regions are the ones compared at 0.001; a number in brackets is the measured share where it is not zero
(sidebar: 88 pixels of 237,888 = 0.00037, the 3 px accent bar that the tenant theme draws on the active shortcut; every region not listed with a number has 0 different pixels).

| Screen | Built in | What the real UI shows instead of the mockup | Gated regions | Whole page |
|---|---|---|---|---|
| ADM-01 org tree | M2d | the real tree, the create form and the field "Mã đơn vị" (not in `screen_catalog.json`) instead of the step cards; real actions instead of "Xuất" and "Lưu / Tiếp tục"; footer note names the real data scope | sidebar, top bar, heading, card top-left | 0.0235 |
| ADM-02 members and invitations | M2f | real memberships, roles, invitations and validity instead of the sample rows; the invitation button instead of "Xuất" and "Tạo mới" | sidebar (0.00037), top bar, heading | 0.0169 |
| ADM-03 roles and grants | M2d | the real role matrix and grants table instead of the placeholder matrix; real actions | sidebar (0.00037), top bar, heading, left card title, right card title, right card note | 0.0264 |
| ADM-08 signing certificates | M2f | the certificate register with the 30-day expiry warning; the mockup is the generic prototype form | none (no visual case yet) | not measured |
| ADM-14 security policy | M2f | the versioned policy form (MFA roles, session limits, IP allowlist, download TTL, watermark); the mockup is the generic prototype form | none (no visual case yet) | not measured |
| ADM-17 guest contractors | M2f | the real guest contractor list with contract scopes | sidebar (0.00037), top bar, heading | 0.0131 |
| DOC-05 leader signing | M2f | the real picker, checks and preview below the two card titles | sidebar (0.00037), top bar, heading, left card title, right card title | 0.0427 |
| DOC-06 numbering and seal | M2f | the real fields below the seven step cards | sidebar (0.00037), top bar, heading, card head | 0.0320 |
| DOC-07 signature report | M2f | the real checks and signatures table instead of the six sample check rows | sidebar (0.00037), top bar, heading with back link (27 of 52,000 = 0.00052) | 0.0322 |
| DOC-10 outgoing register | M2f | the real register rows and filters | sidebar (0.00037), top bar, heading | 0.0111 |
| DOC-21 number registers and types | M2f | the real registers and the document type form | sidebar (130 pixels = 0.00055), top bar, heading | 0.0345 |
| IAM-04 tenant chooser | M2e | one card per membership instead of three generic cards; the open group lists the four shortcuts of `navigation_architecture.json`, the baseline one | sidebar top (88 of 146,664 = 0.00060), sidebar foot, top bar, heading, first card top | 0.0086 |
| IAM-09 my effective access | M2f | the real grants, scopes, permissions, delegations and plan benefits; no tabs (no operation behind them) | sidebar top, sidebar foot, top bar, heading | 0.0205 |
| NOT-01 inbox | M2e | the title key, priority and read state the API serves instead of four sample notifications with body text; no heading buttons | sidebar, top bar, heading | 0.0377 |
| NOT-02 notification detail | M2e | the same, for the detail and the acknowledgement | sidebar (86 pixels = 0.00036), top bar, heading with back link | 0.0344 |
| SAS-01 tenant list | M2e | the real registry rows instead of the sample tenants and filter bar | sidebar, top bar, heading | 0.0096 |
| SAS-02 create tenant | M2e | the real creation form | sidebar, top bar, heading with back link (9 of 52,000 = 0.00017) | 0.0319 |
| SAS-03 tenant detail | M2f | the real lifecycle, entitlement table and actions instead of the sample cards | sidebar, top bar, heading with back link (0.00017) | 0.0144 |
| SAS-04 tenant theme | M2f | the form edits the draft of a tenant picked from the registry (the mockup edits a simulated role) | sidebar, top bar, heading, callout, settings card title, preview card head | 0.0412 |
| SAS-12 issue license | M2f | the real issue form | sidebar, top bar, heading | 0.0287 |
| SAS-13 license detail | M2f | the revision, its state and the signature check instead of the chart and task list | sidebar, top bar, heading with back link | 0.0135 |
| SAS-15 suspend or revoke | M2f | the confirmation of the change of state | sidebar, top bar, heading with back link | 0.0157 |
| SAS-22 provisioning progress | M2f | the timeline of the eleven steps instead of the five step cards | sidebar, top bar, heading with back link (0.00017) | 0.0196 |
| SAS-25 entitlements | M2e | the real entitlement table | sidebar, top bar, heading | 0.0135 |

Also gated and equal to the baseline: the shell frame on ADM-01 (`shell-frame:sidebar`, `shell-frame:topbar`) and the six state
cards `states/web-{loading,empty,error,denied,offline,expired}.png`. The browser report of the same run: 87 visual cases
pass, none fails, none is pending.

## The exact decision needed from the product owner

For each row of the table, one of three answers (the answer for a group of screens may be given once):

1. **Approve the real UI as the new baseline** (R10 step 9c). Then the real screen is drawn into the prototype and
   `screen_catalog.json` (with the source FR of each new field, step 4), exported to a new PNG with the existing export script, committed
   as the new baseline, and the whole page of that screen is gated at 0.001 instead of its regions.
2. **Keep the mockup binding.** The PO lists what the application must change to match the mockup (for ADM-01 and ADM-03: the step
   cards and the placeholder matrix are generic prototype content that has no data behind it). The screen is changed, the regions stay.
3. **Accept the regions as the visual criterion** for the screen until its content is drawn. The whole-page ratio stays informational.

Questions inside the answers, which only the PO can settle:

- **ADM-01:** is the extra field "Mã đơn vị" accepted (its source requirement is FR-ADM-01 and `organization_unit.code`)? The mockup's
  "Xuất" and "Lưu / Tiếp tục" buttons are not built: no operation stands behind them. Remove them from the mockup or name the operation.
- **IAM-04 and every screen with an open group:** the baselines list the shortcuts the prototype had at export time; the application lists those of
  `navigation_architecture.json`, the single source of the navigation. Is the navigation file the truth (the baseline sidebar is then re-exported)?
- **IAM-09:** the mockup has four tabs (Tổng quan, Số liệu, Tải liệu, Lịch sử) and a chart that no operation backs. Drop them from the mockup, or schedule the operations.
- **ADM-08 and ADM-14:** the mockups are the generic form, so a visual case would compare nothing of the screen. Draw these two screens (R10 step 8) or accept the component tests as their only check.
- **Linux rendering:** the baselines were rendered by Chrome on Windows. The `Browser` workflow renders on Ubuntu; if pixel
  differences appear there from fonts alone, the decision is whether to re-export the baselines on the CI image (a baseline change, so a PO approval) or to keep Windows as the reference machine.

## What is not done, and where it is tracked

- The prototype (`02_Prototype`), `screen_catalog.json` and the exported PNGs were **not** changed. Redrawing 24 screens into the prototype, exporting
  their images and recording a change request for every real field is the R10 work that follows the PO's answer 1; it is recorded in `TODOS.md` ("R10 baseline approvals") and not
  started, because a catalog edit without the matching prototype and PNG would make the three disagree, and the design consistency gate
  (`design-check`) and the baseline preservation gate treat them as one package.
- Nothing in `change_log.json` or `baseline_change_register.json` was touched; no baseline PNG was replaced.

## Screen contract checks `UI-<screen>`: the tool is not identified

Eighteen R0 acceptance criteria end with "the screen contract checks of UI-<screen> report 0 failures" (ADM-01, ADM-03, ADM-08, ADM-14, ADM-17,
IAM-01, IAM-03, IAM-04, NOT-01, NOT-02, SAS-01, SAS-02, SAS-03, SAS-04, SAS-12, SAS-13, SAS-15, SAS-22; the ones for ADM-004 and ADM-005 are
`UI-ADM-01` and `UI-ADM-03`). `UI-<screen>` is a test case of `03_Engineering/test_cases.json` (type `screen-contract`, status
NOT_RUN); no tool in the repository runs it, and none is named in the plan. Until a tool exists, these checks stand in for it:

| Step of the test case | Stand-in |
|---|---|
| Open the route by menu and by deep link; no crash or overflow | route walk: every route renders the shell at 1440 and 390 px with no console error and, at 1440 px, no horizontal overflow (`apps/web/e2e/route-walk.spec.ts`, AC-ST-KERNEL-111-1) |
| The frame, the heading and the card heads equal the mockup | the gated regions of the table above |
| Loading, empty, error and denied (and the other three) states | component tests of each screen ("the standard UI states" or "the seven states" describe blocks) and `StateBoundary.test.tsx`; the six state cards in the visual spec |
| Actions follow the permission and the rule | component tests with and without the write permission, and the API permission tests behind them |
| Every control has a label; keyboard order | testing-library queries by accessible name in the component tests; there is no automated keyboard or axe run yet |
| Responsive, back keeps the context | the 390 px half of the route walk; back-link cases in component tests |

The stand-in does not check field names against `screen_catalog.json` or run an accessibility engine: those steps are not covered, and a
screen is not claimed to pass `UI-<screen>` as a whole. The acceptance criteria that name it are marked in `docs/UAT-COVERAGE.md` by the tests
that carry their id (the state and region tests above); the missing tool is the remaining gap.
