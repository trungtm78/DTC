# Protocol gates (CI and pre-ship)

`AUTONOMOUS_EXECUTION_PROTOCOL.md` is enforced by code, not by memory. The same gates run in
GitHub Actions (`.github/workflows/ci.yml`) and locally before shipping.

```bash
node ci/src/verify-cli.mjs                 # all gates against origin/main (or the whole repo if absent)
node ci/src/verify-cli.mjs --base <ref>    # explicit comparison base
node ci/src/verify-cli.mjs --codex         # adds the Codex cross-model review (local only)
node ci/src/verify-cli.mjs --ship          # ship readiness: gates + clean tree + up to date + mandatory Codex review
cd ci && npm test                          # the gates' own tests, 90% line coverage floor
git config core.hooksPath .githooks        # run the gates automatically on every push
```

## Gate to protocol mapping

| Stage | Protocol rule | What fails it |
|---|---|---|
| `protocol-scan` | §5 banned shortcuts, §4 English code, §8c secrets | Added lines containing a type/lint suppression, empty catch, skipped or focused test, TODO/FIXME/HACK, lowered coverage threshold, non-English text in source, or a secret pattern. Fixed sleeps are reported as warnings for review. |
| `progress` | §7 template, §8 stop conditions | First line is not a valid `STATUS:` sentinel; missing section; `IN_PROGRESS` without `BƯỚC TIẾP THEO:`; `ALL_MILESTONES_DONE` without a fully passing `UAT-COVERAGE.md`; `BLOCKED` without the four-part report. |
| `commits` | §4 English commits | Subject is not a conventional commit, contains non-ASCII text, or exceeds 100 characters. |
| `design-tests` | §3 items 2, 3 | The design tooling test suite fails or drops below the 90% line floor defined in its `package.json`. |
| `design-check` | §6 alignment with the spec | The design consistency checker reports errors (IDs, links, tests, API, data model, RLS convention, error-code aliases, module specs). Blocking since the findings were cleared (`ci/config.json`). |
| `baseline-preservation` | Baseline-first rule | A baseline v1.3 ID, table, column or paragraph disappeared, or a changed baseline record has no change request (`baseline_change_register.json`). Compares with the `baseline-v1.3` tag. |
| `sql-verify` | §3 item 2 (tests executed, not assumed) | The reference schema `schema_reference.sql` fails to execute on a real PostgreSQL (embedded build, pgvector replaced by `real[]` in the test profile), or a table with `tenant_id` lacks enabled and forced row-level security or the `tenant_boundary` (RESTRICTIVE) and `tenant_access` (PERMISSIVE) policies. Blocking (`ci/config.json`); takes about 15 seconds. |
| `product-tests` | §3 items 2, 3 (product code) | In the repository root, `npm test --workspaces --if-present`, `npm run lint` or `npm run architecture` exits non-zero (tests, 90% line floor, lint, module-boundary rules). `SKIPPED` when no root `package.json` exists. Blocking (`ci/config.json`). |
| `review-labels` | §4 human review of risky changes | Pull requests only (GitHub Actions job `review-labels`). A changed path matches `ci/review-rules.json` and the PR lacks the human approval label for that item. Local runs report `SKIPPED` because there is no PR context. See "Human review labels" below. |
| `codex-review` | §4 checkpoint (`/codex` after `/review`) | Codex reports a Critical or High finding, or returns no `Recommendation:` line. If Codex is unavailable the stage is `SKIPPED` and earns no credit. |

`--ship` adds `ship-readiness` (no uncommitted changes, branch not behind its upstream) and makes the
Codex review mandatory: an unavailable Codex fails the run instead of being skipped.

## Human review labels

`ci/review-rules.json` maps path globs to review labels `review:<item>`, with `<item>` from the closed list
`money`, `authorization`, `tenant-isolation`, `migration`, `legal-template`, `legal-rule`, `ai-decision`,
`privacy`, `security`. A human reviewer satisfies an item by applying `review:approved:<item>` to the PR; the
bare `review:<item>` label never satisfies it. The `review-labels` job runs
`node ci/src/review-labels-cli.mjs` with `PR_LABELS` (JSON array from the event) and `REVIEW_BASE`
(the PR base SHA), compares `git diff --name-only <base>...HEAD` against the rules and exits 1 listing every
item without an approval. Adding or removing a label re-runs the workflow (`labeled`/`unlabeled` triggers).
Make `Human review labels` a required status check in branch protection; with no required check the job cannot block a merge.

| Path glob | Required labels |
|---|---|
| `db/migrations/**` | `review:migration` |
| `packages/db/**` | `review:tenant-isolation` |
| `packages/kernel/src/signed-context.ts`, `packages/kernel/src/tenant-*.ts` | `review:tenant-isolation`, `review:security` |
| `**/pay*/**`, `**/ledger*/**`, `**/payment*` | `review:money` |
| `**/iam*/**`, `**/policy*`, `**/permission*` | `review:authorization` |
| `Design/MACHVON_Design/03_Engineering/legal_*` | `review:legal-rule` |
| `**/ai/**`, `**/llm/**` | `review:ai-decision` |

Globs support `**` (any depth), `*` (within one segment) and `?`. Rules with a label outside the vocabulary
make the CLI fail, so a typo cannot silently disable a gate.

## Shipping a release

1. `node ci/src/verify-cli.mjs --ship` locally, with every finding resolved.
2. Tag the commit (`git tag v1.4.0 && git push origin v1.4.0`). `.github/workflows/release.yml` re-runs the
   gates on the tagged commit, then publishes release notes generated from the conventional commits.
   It deploys nothing; there is no runtime to deploy yet.

Not automated here, by design: `/review`, `verification-before-completion`, `/plan-eng-review` and
the UAT run itself are performed by the agent per the protocol; the gates check their artefacts
(`PROGRESS.md`, `UAT-COVERAGE.md`).

## Delivery (CD)

There is no product to deploy yet (milestone M1 is the design phase), so the release workflow only
publishes notes. When product code lands, add a deploy job that depends on `gates` plus a smoke test
against the target environment; never add a deploy job that skips the gates.

## QA

QA is the UAT phase of the protocol (section 9): `UAT-COVERAGE.md` lists every screen and function with
columns `ID | Screen/Function | Written | Run | Result`. The `progress` gate refuses
`STATUS: ALL_MILESTONES_DONE` unless every row is PASS, so UAT cannot be skipped by declaring completion.
The UAT run itself needs a running product and belongs to milestone M6.

## Scanning rules

`ci/src/rules.mjs` holds the patterns. The Vietnamese UI mockup (`02_Prototype/`) is exempt from the English-code rule only; every other rule still applies to it. Paths `ci/test/**` and `ci/src/rules.mjs` are excluded
because they spell the banned patterns out as fixtures. Message text lives in `ci/src/messages/*.json`.
