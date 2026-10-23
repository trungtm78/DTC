# Release checklist

What has to be true, and what to attach, before a release is promoted. Every line names the command or the file that
answers it; a line that cannot be answered is a blocker, not a note.

## 1. Automated gates (all green on the commit to release)

| Gate | Where it runs | Command to reproduce locally |
|---|---|---|
| Protocol gates, product tests, script tests, SBOM, supply chain | `CI` workflow | `npm test`, `npm run lint`, `npm run typecheck`, `node ci/src/verify-cli.mjs` |
| Browser lane: route walk (406 routes at 1440 and 390 px), browser flows, visual regions | `Browser` workflow | `npm run test:lane -- browser npm run e2e -w @machvon/web`, then `node scripts/e2e-report.mjs --require-walk --require-visual` |
| Acceptance traceability | `npm run lint` | `node scripts/uat-trace.mjs --check` |
| Contracts | `CI` | `npm run contracts:check`, `npm run contracts:compat` |
| Migrations | `CI` and `Deploy` preflight | `npm run db:check`, `npm run migrations:check`, `npm run expand-contract:check` |
| Infrastructure and alerts | `Deploy` preflight | `npm run infra:check`, `npm run alerts:check` |
| Supply chain | `CI` | `npm run sbom`, `npm run supply-chain:check -- --audit` |

Database-backed and browser runs on a developer machine go through the lanes of `test-lanes.md`; never more than one at a time.

## 2. The browser lane

1. Open the `Browser` run of the release commit. The job `Route walk, flows and visual regions` must be green.
2. Download the artifact `browser-report` (`apps/web/e2e/report.json`) and run `node scripts/e2e-report.mjs --require-walk --require-visual` on it
   (`--report <file>`): no broken page, no failed, pending or stale visual case.
3. A red visual case is read from the artifact `browser-diff-images` (`apps/web/e2e/__diff__/<case>.diff.png`). The target
   ratio 0.001 is never raised and a region is never shrunk to make a case pass (`web-e2e.md`). The baseline PNGs were
   rendered by Google Chrome on Windows; if a case is red on the Linux runner only because of font rendering and is
   green on the Windows reference machine, record both runs in the release notes and ask the owner of the baselines
   (the product owner, see `docs/r10-baseline-approvals.md`) for the decision; do not edit a baseline or a threshold to release.

## 3. Traceability and status

1. `docs/UAT-COVERAGE.md` is current (`node scripts/uat-trace.mjs --check`) and every story with the status DONE in
   `docs/story-status.json` has every acceptance id named in a live test title.
2. Stories that are DONE_PENDING_ENV (a named external check is outstanding) or DONE_UNCONFIRMED (a legal basis is not
   confirmed, `legal_confirmation_ledger.json`) are listed in the release notes with the check or the confirmation that
   is missing, its owner and the command that runs it once the environment exists. A release does not claim them as
   verified.
3. `docs/r10-baseline-approvals.md`: the screens that differ from their mockup and the decisions still open are listed in the
   release notes. A screen the product owner has not approved keeps the label "visual approval pending" and its
   gated regions stay the only visual gate.

## 4. Human gates

1. Pull requests: the `Human review labels` check is green (`review:approved:<item>` for every item `ci/review-rules.json`
   requires, applied by a human who is not the author, after the last push).
2. The Codex review of the release range has no Critical or High finding left open.
3. `PROGRESS.md` ends with `STATUS: ALL_MILESTONES_DONE` only when the UAT matrix is fully passing; otherwise the release
   is an interim one and says so.

## 5. Promotion

1. Staging follows every green `CI` run on main (`.github/workflows/deploy.yml`, `infra/pipelines/staging.json`).
2. Production is started by hand from the `Deploy` workflow with the cohort to promote (`pilot`, `cohort-1`, `all`). It needs the
   gates `staging-green`, `expand-contract`, `n-minus-1-compatibility` and `supply-chain`, and two approvals from the
   roles `release-manager` and `security-administration` (`infra/pipelines/production.json`). The `n-minus-1-compatibility`
   harness does not exist yet (`TODOS.md`): until it does, that gate is answered by a person, in writing, in the release notes.
3. The canary steps are 5, 25 and 100 percent with a 30 minute bake; error rate, p95 latency and an isolation violation abort it.
4. Rollback is a redeploy of the previous release within 15 minutes; a schema change is never rolled back, which is why the
   expand-contract rule exists (`infra/rollback.md`). A feature flag switches a feature off without a deploy.
5. Components of `infra/components` that are still `PLANNED` have no restore evidence; the release notes list them
   (`npm run infra:check -- --require-entered <component>` fails for one that is not entered).

## 6. Evidence to attach to the release

- The `Browser` artifacts `browser-report` and `browser-diff-images`.
- `docs/UAT-COVERAGE.md` and `docs/story-status.json` at the release commit.
- The SBOM artifact `sbom-cyclonedx` of the `CI` run.
- The output of `npm test`, `npm run lint` and `npm run typecheck` (counts of tests and suites) and the line coverage of the touched packages.
- The list of open items: DONE_PENDING_ENV stories, `docs/r10-baseline-approvals.md` decisions, and the carry-overs of `TODOS.md`.
