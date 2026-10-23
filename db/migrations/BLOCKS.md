# Migration numbering blocks

Every migration file is `V<number>__<lower_snake_name>.sql`. The number decides who owns it, so parallel slices never
collide on a version number. `npm run migrations:check` (part of `npm run lint`) enforces the rules below.

| Range | Owner | Rules |
|---|---|---|
| V001, V002 | generator | `npm run db:generate` writes them from `schema_reference.sql`; never edit, never rename |
| V003 to V099 | platform foundation (R0) | three digits (`V010`); the next free number; a number that was skipped is listed in `blocks.json` under `platform.retired` (V005) |
| V1000 and up | one block of twenty numbers per R1 slice | the slice key (the slice id in lower case without the hyphen) starts the name: `V1020__iss1_issue_register.sql` |

Rules:

- A slice only uses numbers inside its own block and only in order without gaps (a number that cannot be used stays
  free; if it must stay unused for good, add it to the block's retired list in `blocks.json`).
- A slice that needs more than twenty migrations asks the integrator for a new block; blocks are never resized.
- Applied migrations are never edited: `migrate` stores a SHA-256 of each file and refuses a changed one. A fix is a new migration.
- Platform migrations after V009 (the R0 work that is still open) take the next free number V010 and up.
- The reserved blocks come from the order of the slice table in `docs/superpowers/plans/2026-10-23-m3-r1-breadth-roadmap.md`
  (section 4): block = V<1000 + 20 x index> to V<1019 + 20 x index>, index counted from zero.

## Slice blocks

| Slice | Key | Block |
|---|---|---|
| KERNEL-1 | `kernel1` | V1000 to V1019 |
| DGV-1 | `dgv1` | V1020 to V1039 |
| DIS-1 | `dis1` | V1040 to V1059 |
| ISS-1 | `iss1` | V1060 to V1079 |
| MDM-1 | `mdm1` | V1080 to V1099 |
| MOB-1 | `mob1` | V1100 to V1119 |
| KERNEL-2 | `kernel2` | V1120 to V1139 |
| LLM-1 | `llm1` | V1140 to V1159 |
| MOB-2 | `mob2` | V1160 to V1179 |
| PMT-1 | `pmt1` | V1180 to V1199 |
| PRJ-1 | `prj1` | V1200 to V1219 |
| DOC-1 | `doc1` | V1220 to V1239 |
| IAM-1 | `iam1` | V1240 to V1259 |
| MOB-3 | `mob3` | V1260 to V1279 |
| OMNI-1 | `omni1` | V1280 to V1299 |
| ADM-1 | `adm1` | V1300 to V1319 |
| AUD-1 | `aud1` | V1320 to V1339 |
| BID-1 | `bid1` | V1340 to V1359 |
| CAP-1 | `cap1` | V1360 to V1379 |
| CTR-1 | `ctr1` | V1380 to V1399 |
| DIS-2 | `dis2` | V1400 to V1419 |
| MOB-4 | `mob4` | V1420 to V1439 |
| NOT-1 | `not1` | V1440 to V1459 |
| QMS-1 | `qms1` | V1460 to V1479 |
| SAS-1 | `sas1` | V1480 to V1499 |
| SAS-2 | `sas2` | V1500 to V1519 |
| AST-1 | `ast1` | V1520 to V1539 |
| CTR-2 | `ctr2` | V1540 to V1559 |
| PAY-1 | `pay1` | V1560 to V1579 |
| BI-1 | `bi1` | V1580 to V1599 |
| CAP-2 | `cap2` | V1600 to V1619 |
| CTR-3 | `ctr3` | V1620 to V1639 |
| DIS-3 | `dis3` | V1640 to V1659 |
| HOME-1 | `home1` | V1660 to V1679 |
| LND-1 | `lnd1` | V1680 to V1699 |
| MNE-1 | `mne1` | V1700 to V1719 |
| PAY-2 | `pay2` | V1720 to V1739 |
| PRJ-2 | `prj2` | V1740 to V1759 |
