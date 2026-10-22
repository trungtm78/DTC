# Protocol gates (CI and pre-ship)

`AUTONOMOUS_EXECUTION_PROTOCOL.md` is enforced by code, not by memory. The same gates run in
GitHub Actions (`.github/workflows/ci.yml`) and locally before shipping.

```bash
node ci/src/verify-cli.mjs                 # all gates against origin/main (or the whole repo if absent)
node ci/src/verify-cli.mjs --base <ref>    # explicit comparison base
node ci/src/verify-cli.mjs --codex         # adds the Codex cross-model review (local only)
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
| `design-check` | §6 alignment with the spec | The design consistency checker reports errors. Non-blocking until milestone M1 closes (`ci/config.json`); flip `designCheck.required` to `true` in the task that clears the findings. |
| `codex-review` | §4 checkpoint (`/codex` after `/review`) | Codex reports a Critical or High finding, or returns no `Recommendation:` line. If Codex is unavailable the stage is `SKIPPED` and earns no credit. |

Not automated here, by design: `/review`, `verification-before-completion`, `/plan-eng-review` and
the UAT run itself are performed by the agent per the protocol; the gates check their artefacts
(`PROGRESS.md`, `UAT-COVERAGE.md`).

## Delivery (CD)

There is no product to deploy yet (milestone M1 is the design phase), so no deploy job exists.
When product code lands, add a release workflow that depends on `gates` and a smoke test against
the target environment; never add a deploy job that skips the gates.

## Scanning rules

`ci/src/rules.mjs` holds the patterns. Paths `ci/test/**` and `ci/src/rules.mjs` are excluded
because they spell the banned patterns out as fixtures. Message text lives in `ci/src/messages/*.json`.
