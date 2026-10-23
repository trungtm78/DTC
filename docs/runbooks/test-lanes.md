# Test lanes and the shared test database (K0)

This machine (Windows, limited commit memory) cannot run many PostgreSQL servers and browsers at once: orphaned or
parallel servers exhaust commit memory (Windows error 1455) and suites hang or flake. Two mechanisms keep the load
bounded.

## 1. One shared PostgreSQL server per database-backed test run

`packages/db` and `apps/api` run their suites through the Jest global setup `packages/db/jest.global-setup.mjs`:

1. it takes the `db` lane (see below), so only one database-backed run exists on the machine;
2. it removes what an interrupted earlier run left behind (servers of this repository whose directory has the prefix
   `machvon-pg-shared-`, only when the run that owned them is gone: pid and start time are checked, see
   `packages/db/src/test-hygiene.ts`);
3. it starts ONE embedded server (small flags, 300 connections), creates the six MACHVON roles once and applies every
   committed migration into the database `machvon_template` (test profile). The template accepts no connections;
4. it publishes the server in `MACHVON_SHARED_DB` (JSON; the workers inherit it).

The teardown stops the server, removes `.test-locks/shared-db.json` and releases the lane.

In a suite:

| Need | Call | Result |
|---|---|---|
| a migrated database (almost every suite) | `startMigratedTestDatabase(REPO_ROOT)` or `createTestDatabase()` | a private copy of the template (`CREATE DATABASE ... TEMPLATE ... STRATEGY FILE_COPY`) on the shared server; `stop()` drops it |
| an empty database with the roles | `createEmptyTestDatabase()` | `CREATE DATABASE`, no schema |
| work with automatic clean-up | `withTestDatabase(async (db) => ...)` | clone, run, drop |
| a pristine server of its own | `startTestDatabase(options)` or `startMigratedTestDatabase(root, { tempPrefix })` | a dedicated server, as before |

`startMigratedTestDatabase` uses the shared server only when it exists, holds the migrations of the same root, and the
call gives no private option (`usesSharedDatabase`). Suites that stay on a server of their own, and why: the CLI and
migration suites (`cli`, `migrate`, `migration-upgrade`: they need a database with no schema and a fresh migration
ledger), `test-database` (tests the server lifecycle), `tenant-database` (starts unmigrated), `rls-catalog` (reads
cluster-wide facts of a server nothing else touches), `platform-services-migration` (private prefix and a broken
migration root), the e2e stack, and the two servers inside `template-database.test.ts`.

Rules for a suite that runs on the shared server:

- Clones share ROLES. Never act on a role by name across databases (`pg_terminate_backend` or a lock probe filtered by
  `usename` alone): add `datname = current_database()`.
- Roles' passwords belong to the server: never `ALTER ROLE` in a test.
- Close pools before `stop()`; `stop()` uses `DROP DATABASE ... WITH (FORCE)` so a forgotten pool cannot hang the drop.

Switches:

- `MACHVON_SHARED_DB=off`: every suite starts a server of its own (the old behaviour; used for the measurements below).
- `MACHVON_TEST_LANE=unit`: the global setup starts nothing and takes no lane (run light suites only, for example
  `npx jest path` for a suite that does not need a database).

## 2. Lanes

`scripts/lane.mjs` serialises heavy runs with a lock directory under `.test-locks/` (git-ignored): first in, first out,
a lock whose process died (or that is older than 30 minutes) is reclaimed, and waiting is reported every 30 seconds.
Queue tickets are written to a temporary dot file and renamed into place, an unreadable ticket keeps its place until it has
been unreadable for two seconds, and the lock records an ownership token so a handle never removes a lock that another
process took after reclaiming it. Everything after the lane name is the command line, verbatim; a single leading `--`
is optional (`npm run test:lane -- db npm test -w @machvon/api -- notifications` works as written).

| Lane | For | How |
|---|---|---|
| `db` | every Jest run of `packages/db` and `apps/api` | taken by the global setup itself; to run a command under the lane: `npm run test:lane -- db <command>` |
| `browser` | Playwright (route walk, flows, visual) | `npm run test:lane -- browser npm run e2e -w @machvon/web` (the manual `apps/web/e2e/.run-lock` described in web-e2e.md is the same rule) |
| `verify` | the full gate set before a push | `npm run test:lane -- verify <command>` |

Light unit and component tests (kernel, contracts, design tokens, web with vitest, scripts) take no lane and may run in
parallel with one `db` run. A command started through `lane.mjs` carries `MACHVON_LANE_HELD=<lane>`, so the jest global
setup inside it does not wait for itself. When the shared server is stopped the global teardown also clears
`MACHVON_SHARED_DB` (if the value is the one this setup wrote), so a later setup in the same process (watch mode)
starts a server again instead of mistaking the stale value for an outer run's.

## 3. Measurements (Windows development machine, other agents' jobs running at the same time)

`npm test -w <package>`, wall time and peak number of `postgres.exe` processes of this repository (sampled every two seconds):

| Run | Before (one server per suite) | After (shared server) |
|---|---|---|
| `packages/db` (36 suites, 426 tests) | 165 s; 4 main servers; 44 processes | 140 s (Jest time 123 s); 2 main servers; 52 processes |
| `apps/api` (40 suites, 551 tests) | 120 s; 4 main servers; 52 processes | 71 s; 1 main server; 28 processes |

Reading the numbers:

- The number that matters for memory is the number of MAIN servers (each reserves shared buffers and commit memory).
  It fell from 4 to 2 (db) and from 4 to 1 (api). The process total can rise because one server now serves many
  connections (more backend processes).
- One copy of the 36 MB template costs about 1.9 s alone and about 8 s for twenty at once (`FILE_COPY`; `WAL_LOG` took
  about twice as long). The roadmap's 100 ms is not reachable here; a server of its own costs about 15 s per suite.
- `packages/db` improved less than `apps/api` because about a dozen suites there must keep a server of their own, and a few
  suites dominate the wall time.

## 4. Orphans after an interrupted run

A run killed with Ctrl+C or by a timeout does not run its teardown. The next database-backed run reclaims the stale lane
lock (dead pid) and stops the leftover servers (`test hygiene:` lines on stderr). To clean by hand, stop only
`postgres.exe` processes whose command line contains `C:/PIS/node_modules/@embedded-postgres` and
`machvon-pg-shared-`; never use broad kills, and never other projects' servers.
