# KERNEL-003: PAdES leader signature, numbering by incremental update, organisation seal

Status: **DONE_PENDING_ENV for the sandbox part; NOT RUN against a real CA** (the signature work is Task 18 of the
M2f plan, lane D; this report records only what is known without a sandbox).
Story: ST-KERNEL-003 (SPIKE-CA-SANDBOX).

## Question

Can a PDF be signed by the leader with PAdES, receive its number by an incremental update, be sealed by the
organisation, and both signatures verify with two independent tools on a real CA sandbox? If there is no sandbox, the
uploaded-externally-signed path is the primary path of R1.

## Method

Planned: sandbox CA issues one personal and one organisation test certificate; the leader signs revision 0, the register
adds the number as revision 1, the organisation seals revision 2; two independent validators check the file.

## What ran here

No sandbox CA exists in this environment, so no signature by a real certificate was made and no validator was run.
The parts that need no CA are built by the documents lane (Tasks 17 to 19): the signature domain types and findings
(`packages/kernel/src/pades.ts`), the signing certificate registry, the numbering registers, and, in Task 18, the verifier,
the incremental signing writer and the hash-only signing port with a MOCK adapter. Their evidence is in
[DOC-SPK-01](DOC-SPK-01.md); the numbering revision and the organisation seal come with Task 19.

## Evidence

None from a CA. A signed file made with a test authority verifies, and the verifier refuses every change outside the allowed set
(DOC-SPK-01). The AC-3 conclusion below is recorded because it follows from the missing input, not from a test.

## What did not run and why

AC-1 (two valid signatures on three revisions, prefix bytes of revision 0 unchanged, DocMDP support recorded) and AC-2
(sandbox unreachable: the document stays `NUMBERED`, `PROVIDER_UNAVAILABLE`, retry without a second number) need the
sandbox. The design lists the signing adapter as PROPOSED with the spike as its entry condition (04_Thiet_ke_co_ban.md,
integration table).

## Decision

AC-3: with no sandbox at the end of this spike, **the external-upload path (a document signed outside the system and
uploaded) is the primary path of R1**; in-system signing stays behind its port with a MOCK adapter. Inputs still
missing from D05 (the customer's inputs): a CA sandbox account with API documentation; one personal and one
organisation test certificate; the CA's statement on DocMDP and on long-term validation (LTV) support; the trust list
the customer's regime uses (`PUBLIC_CA` or `GOV_SPECIALIZED`). Owner: integration lead. To run it: obtain those inputs,
build the signing harness behind the signing port, and fill AC-1 and AC-2 here.
