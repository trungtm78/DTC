# Documents: PDF rendering and number registers

Applies to ST-DOC-001 and ST-DOC-002 (`apps/api/src/modules/doc`, `packages/db/src/document-store.ts`,
`packages/db/src/number-register-store.ts`, migrations V015 and V016).

## Deterministic PDF

- `PdfLibRenderer` gives the same bytes for the same input. The input is the template digest and revision, the layout
  profile, the normalised payload, the as-of date, the renderer version and the watermark text. The PDF has no clock:
  `CreationDate` and `ModDate` are 00:00 (UTC+7) of the as-of date, the file identifier is the first 16 bytes of the input
  hash, and the font subset tags are fixed (`customName`).
- The fonts are vendored in `apps/api/src/modules/doc/fonts` (Tinos, SIL OFL, the metric substitute of Times New Roman) and
  the fixed words of a state document in `state-text.json`. The renderer finds them from the working directory of the
  process (the repository root or `apps/api`) or from `MACHVON_DOC_RESOURCES`.
- `apps/api/test/doc/pdf-renderer.test.ts` holds a golden SHA-256. A change of the drawing code, the fonts or `pdf-lib`
  changes the digest on purpose: bump `RENDERER_VERSION` in `pdf-renderer.ts` in the same commit, run the test, and replace
  `GOLDEN_SHA256` with the digest it prints. Documents already stored keep their old bytes and their old renderer version.
- The test also renders in child processes with another `TZ` and locale; if it fails there, something locale or clock
  dependent crept into the renderer.

## Document versions

- A stored version never changes (trigger of V015): only the scan result may be filled in, once, from `PENDING`.
  A fix is a new version. The owner role (migrations, tamper drills) is exempt.
- Download: the scan must be `CLEAN`, the URL lives at most 300 seconds. `PENDING` answers 409 `SCAN_PENDING`;
  `INFECTED` answers 403 `SCOPE_DENIED` and writes a DENIED audit row whose diff says `INFECTED_FILE_BLOCKED`.
- Until the platform object storage is bound (KERNEL-024) the module runs on the in-memory `MockDocumentFilePort`: files
  do not survive a restart. Bind a real `DocumentFilePort` under the `DOCUMENT_FILE_PORT` token.
- A render writes the file before the database rows are committed: a failed commit leaves an unreferenced object that the
  storage clean-up (KERNEL-024) removes.

## Signature verification and signing sessions

- A revision appended after a signature is judged by its objects and by its cross-reference data (tables and streams): it
  may map only the objects it defines, must chain to the revision before it (`/Prev`, `startxref`), may not free objects,
  shrink `/Size`, add `/XRefStm` or `/Encrypt`. A DSS may add objects and rewrite its own, never rewrite content it reaches.
- The DocMDP level of the first signature of a file bounds every later revision: level 1 allows only validation data and
  document timestamps, levels 2 and 3 also the number fields and further signatures.
- A timestamp token counts only when its signer certificate carries `id-kp-timeStamping` alone, marked critical. A path is
  trusted only when every authority may issue (`basicConstraints`, `keyCertSign`) within its `pathLenConstraint`; name
  constraints are not evaluated.
- With a revocation port, the signer, every intermediate authority and the timestamp authority are asked about (the anchor
  is not). Revoked beats unknown beats good.
- A signing step advances a document only on an overall result of `VALID` (`LENIENT_TIME` excuses an unproven signing time,
  nothing else). The signing provider is asked before anything is written; the prepared PDF is stored last, so a provider
  that cannot be reached leaves no object behind.
- The MOCK file system object storage keeps every version of an object in a file of its own under
  `objects/{tenant}/{kind}/{sha256 of the id}/`; a scan verdict is applied only to the bytes it was reached on
  (`setScanStatus(..., expectedSha256)`).

## Number registers

- One register per (register code, organisation unit, year). A number is handed out under `SELECT ... FOR UPDATE` on the
  register row with a 3 second lock timeout (`REGISTER_LOCK_TIMEOUT`); the counter, the allocation and the document change in the
  transaction of the caller, so a failure leaves no gap.
- The year of a number is the year of the issue date in Asia/Ho_Chi_Minh (`REGISTER_YEAR_MISMATCH` otherwise).
- The allocation log is append-only (trigger of V016): the only change is the approved void (`ALLOCATED` to `VOIDED`, with a
  reason and a second person). A voided number is never reused.
- `rolloverRegisters(tx, now, actor)` opens next year's registers; the platform scheduler runs it once per tenant at 00:00
  on 1 January (Vietnam time). `auditRegisterGaps(tx, deps)` looks for numbers missing from 1..last_number and raises the alert
  `DOC_REGISTER_GAP` with the counter `doc_register_gap_total`. A gap is a serious error: stop issuing numbers from that
  register, find the allocation that was deleted (the owner role can still do it) in the audit trail and the database logs,
  and restore it from a backup of the log.
- Closing a register needs its current version in `If-Match` and no outgoing document of the register in `NUMBERED`.

## Tests

- Database: `npm run test:lane -- db npm test -w @machvon/db -- document-store number-register`
- API: `npm run test:lane -- db npm test -w @machvon/api -- test/doc`
- Screens DOC-10 and DOC-21: `npm test -w @machvon/web -- src/screens/doc`; the frame and heading regions are compared in
  `apps/web/e2e/visual.spec.ts` (one browser run at a time, see `web-e2e.md`).
