# DOC-SPK-01: signing port, PAdES verification and the byte-level contract

Status: **DONE_PENDING_ENV** (the verification library, the signing port, its contract suite and the MOCK adapter run here; **the round
trip with a real certification authority was not run**: no CA sandbox exists).
Story: ST-DOC-003 and ST-DOC-004 (UAT-AC403 to UAT-AC406, UAT-AC430). Related: [KERNEL-003](KERNEL-003.md).

## Question

Can the system give a signer only the hash of a byte range, get back a PAdES signature, add the number by an incremental update, seal
with the organisation, and then prove for every signature that the file is intact, the chain is trusted, the signing time is proven and
nothing but the allowed changes came after it (BR-DOC-14)?

## Method

1. `verifyPdfSignatures` (apps/api/src/modules/doc/pades-verifier.ts): for each signature dictionary it checks the `ByteRange` against the
   revisions of the file, the `messageDigest`, the CMS signature with the certificate of the signer, the algorithm allow-list (RSA from 2048
   bits or ECDSA from P-256, SHA-256 or stronger), the `signingCertificate-v2` binding, the chain to the trust anchors of one regime, the
   RFC 3161 timestamp (the proof of the signing time), revocation through a port, and the revisions after the signature through a
   revision analyser with an allowed set.
2. `SigningPort` receives a SHA-256 digest and nothing else; a contract suite (`signing-port.contract.ts`) states what every adapter must do
   and is run against the MOCK adapter and, as a negative control, against adapters that are wrong in one chosen way.
3. The incremental signing writer (`pdf-signing.ts`, `pdf-incremental.ts`) appends a signature revision without touching earlier bytes.
4. The tests build a certification authority, a timestamp authority and signed files in the test itself (`mock-pki.ts`, no binary fixture).

## What ran here

- Kernel model and allow-list: 12 tests, 100 percent of lines.
- PDF reader, writer, revision analyser, CMS and chain verification, signing port: 111 tests in 5 suites (`apps/api/test/doc`), line
  coverage 99.9 percent, branch coverage 87 percent. They include a file written by the renderer (classic cross-reference, no object streams).
- Store and API: 7 store tests (`packages/db/test/signature-store.test.ts`) and the API tests of `apps/api/test/doc/signatures.test.ts` through the
  db lane, with the negative authorization matrix and the isolation suite covering `verifyDocumentSignatures` and `getDocumentSignatureReport`.
- Screen DOC-07: 43 tests; visual case against `DOC-07.png`.

## Evidence

| Rule of BR-DOC-14 f | Test that proves it |
|---|---|
| (1) ByteRange valid and covering a revision | `BYTE_RANGE_INVALID` for a range inside a revision; a range that stops after `%%EOF` is read as whole |
| (2) messageDigest | one byte changed in the signed range gives `DIGEST_MISMATCH` |
| (3) CMS signature | a flipped signature value gives an INVALID report |
| (4) chain to the trust anchor of the regime | `CHAIN_UNTRUSTED`, `CHAIN_INCOMPLETE`, an intermediate authority, `PUBLIC_CA` and `GOV_SPECIALIZED` |
| (5) validity at the proven signing time | `CERTIFICATE_EXPIRED_AT_SIGNING` with a timestamp; `SIGNING_TIME_UNPROVEN` without one; valid after expiry when a timestamp proves it |
| (6) revocation | GOOD, REVOKED before and after the signature, UNKNOWN (INDETERMINATE), not asked |
| (7) revisions after the signature | numbering, next signature field, DSS and document timestamp allowed; page content, catalog, form, annotations, object streams, foreign bytes refused (`INCREMENTAL_CHANGES_NOT_ALLOWED`) |
| (8) order leader before organisation | `SIGNING_ORDER_INVALID` |
| Algorithms | RSA 1024 refused, RSA 2048 and ECDSA P-256 accepted |
| Report holds no private material | exact member list of a signature result; the stored rows and the answers are searched for key text |
| Hash only | the requests the port received carry exactly `digestSha256`, `certificateFingerprint`, `correlationId` |

## What did not run and why

- **A real CA round trip** (AC of DOC-004, KERNEL-003 AC-1 and AC-2): no CA sandbox account, no test certificates, no statement of the CA about
  DocMDP and long-term validation. Owner: integration lead. Command to run it: write an adapter for the CA behind `SigningPort`, then run
  `contractViolations` from `signing-port.contract.ts` against it with a harness whose `approve` confirms in the sandbox, and verify its
  output with `verifyPdfSignatures` and with two independent validators.
- **A second validator** (Adobe Acrobat, EU DSS): none is installed here, so the verifier has been checked against files this repository built
  and against the PDF subset it can read, not against a foreign implementation.
- **OCSP and CRL adapters**: the revocation port is bound to an adapter that answers UNKNOWN; the tests use fakes. Owner: integration lead,
  with the egress allowlist per tenant.
- **Per-tenant trust anchors** (BR-DOC-15): there is no table; every tenant uses the directory named by `MACHVON_TRUST_ANCHORS_DIR`.
- **Signed files from other producers**: signer identifiers by subject key identifier, RSA-PSS, signatures inside object streams and hybrid
  cross-reference files are refused or read as unsupported, never accepted blindly.

## Decision

Keep the port, the contract suite and the MOCK adapter as the interface of Task 19. DocMDP level 2 is written when asked for and recorded by
the verifier; whether the CA supports it is decided by the sandbox run (UAT-AC430). The writer needs files with a classic cross-reference
section and no object streams, which is what the renderer writes (`useObjectStreams: false`); the analyser refuses a revision that touches an
object it cannot read. Until a sandbox exists the external-upload path stays the primary path of R1, as KERNEL-003 decided.
