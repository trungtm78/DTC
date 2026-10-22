## What and why

<!-- One or two sentences. Link the plan task (e.g. M1-T4) and the decision IDs it implements. -->

## Definition of Done (protocol section 3)

- [ ] Meets every acceptance criterion of the task plan
- [ ] Patch coverage is at least 90% line (CI enforces the floor for tooling; attach the report for product code)
- [ ] Full test suite passes with no regression
- [ ] Lint, type-check and build are clean with no new warning
- [ ] No TODO, dead code or temporary workaround in the diff
- [ ] `PROGRESS.md` updated to the section 7 template

## Review checkpoint (protocol section 4)

- [ ] `verification-before-completion` evidence attached (commands and output)
- [ ] `/review` findings resolved
- [ ] Codex review run after `/review` (`node ci/src/verify-cli.mjs --codex`) and every finding resolved

## Safety (protocol section 8c)

- [ ] No secret, credential or production data in the diff, logs or screenshots
- [ ] No force-push, no destructive migration, nothing outside this repository
