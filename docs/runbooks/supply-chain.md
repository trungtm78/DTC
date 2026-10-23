# Supply chain: pins, lockfile, SBOM and audit (K0)

What ships is what the lockfile says. Four checks make that true and leave evidence for a reviewer or an auditor.

| Check | Command | Fails when |
|---|---|---|
| Pinned sources | `npm run supply-chain:check` | a dependency floats (`*`, `latest`, `>=1`, `1.x`, a dist-tag, a range with `\|\|`), comes from a URL, a path or a git reference without a full commit, or is a `^`/`~` range under the `exact` policy |
| Lockfile in sync | `npm run supply-chain:check` | `package-lock.json` is missing, a workspace is not in it, a manifest and the lockfile disagree on a dependency, a dependency has no locked package, or the locked version does not satisfy the manifest |
| SBOM | `npm run sbom`, then `npm run supply-chain:check` | the CycloneDX document is missing or malformed: it needs the format and spec version (1.4 to 1.6), a serial number, a timestamp, and for every component an npm `purl` and (third-party only) a hash |
| Images | `npm run supply-chain:check` | a Dockerfile exists, `supply-chain.json` has no `imageScan` policy (`tool`, `failOn`), or a base image has neither a digest nor a tag other than `latest` |
| Audit | `npm run supply-chain:check -- --audit` | `npm audit` reports a vulnerability at or above the policy level |

Sibling workspace packages (`"@machvon/kernel": "*"`) are linked, not downloaded, so they are exempt from the pin rules.

## Policy: `supply-chain.json`

```json
{ "rangePolicy": "lockfile", "auditLevel": "high", "auditScope": "production" }
```

- `rangePolicy`: `exact` (default: every external dependency is an exact version) or `lockfile` (a `^`/`~` range is
  accepted when the locked version satisfies it, because `npm ci` installs exactly the lockfile). This repository uses
  `lockfile`: its manifests carry caret ranges, and the lockfile is the pin. Moving to `exact` is a one-line policy change
  plus pinning the manifests; the check will list every dependency that still has a range.
- `auditLevel`: lowest severity that fails the audit (`low`, `moderate`, `high`, `critical`), default `high`.
- `auditScope`: `production` (default, `npm audit --omit=dev`) or `all`.
- `imageScan`: `{ "tool": "trivy", "failOn": "HIGH" }`, required as soon as the repository holds a Dockerfile.

## Offline audit

`npm audit` needs the registry. When it cannot be reached (`ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN`, timeouts) the gate
prints `SKIPPED: dependency audit ...` and does not count as a pass; the exit code stays 0 so that a laptop without a
network can still run the other checks. Any other answer that is not an audit report fails the gate. CI always has a
network, so a skipped audit in CI is a CI problem to look at, not a pass.

## SBOM

`npm run sbom` writes `dist/sbom.cdx.json` (CycloneDX JSON from `npm sbom --package-lock-only`), and writes nothing when
the document is not valid. CI publishes it as the artifact `sbom-cyclonedx` for every run. To answer "are we affected by
CVE-X", search the artifact for the package name and version; the `purl` is the join key to vulnerability databases.

## When a check fails

| Finding | Fix |
|---|---|
| `LOCKFILE_OUT_OF_SYNC` | run `npm install`, review the lockfile diff, commit both files |
| `UNPINNED_RANGE` / `FLOATING_SPEC` | write the exact version that the lockfile resolves |
| `UNPINNED_SOURCE` | publish to or use the registry version, or pin the full 40 character commit |
| `SBOM_*` | `npm run sbom`; if npm itself fails, fix the lockfile first |
| `IMAGE_*` | add the `imageScan` policy and pin the base image by digest |
| `AUDIT_VULNERABLE` | upgrade the package; if no fix exists, record the decision in the ticket and lower nothing silently |

## Known open item

Development-only vulnerabilities (`npm audit` without `--omit=dev`) are not a gate yet: the `vitest 4.x` chain pulls
`tinypool` (critical, test runner only) and `@vitest/mocker`, and the fix is the breaking `vitest 5`. They do not ship in
any runtime artifact. Track the upgrade in TODOS.md; set `auditScope` to `all` once it is done.
