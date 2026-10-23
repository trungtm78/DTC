# KERNEL-004: domestic or self-hosted AI model quality and cost for tender-document analysis

Status: **harness DONE; real quality NOT RUN** (no provider keys, no self-hosted model, no expert ground truth).
Story: ST-KERNEL-004 (SPIKE-AI-MODEL).

## Question

How do at least one domestic and one self-hosted route (and a stubbed international route) compare in quality, latency
and cost on Vietnamese tender documents, so that the routing profile and the expert-signed thresholds of D07 can be
proposed with data?

## Method

An evaluation harness in `scripts/ai-eval/`: a signed ground-truth dataset (`signedBy`, items with prompt, expected
answer, pages and classification), route adapters with one contract (`complete(item)` returns text, latency and cost),
word-level F1 scoring, p95 latency (nearest rank) and cost per 1,000 pages. Routing and publishing rules are pure
functions with the registered error codes.

## What ran here

`scripts/ai-eval.test.mjs` (10 tests) runs the harness over mock routes:

- one record per route with `score`, `p95LatencyMs`, `costPer1000Pages`, items and pages; the next route runs through the
  same code with no change (AC-1, mechanism only);
- a route that throws fails the run; an outage is never scored as zero;
- `selectRoute` takes the classification from the stored document and ignores a classification in the request:
  confidential data never reaches the international stub, public data may; no allowed route gives 422
  `INTERNATIONAL_CLASSIFICATION_NOT_ALLOWED` (AC-2, rule only);
- `checkProfilePublish` refuses a profile with a route that has no eval record: 422 `EVAL_MISSING_FOR_ROUTE`, which is
  registered in the error registry (AC-3, rule only; the gateway profile publish itself belongs to the LLM module).

The CLI (`node scripts/ai-eval/harness.mjs --dataset <file>`) only offers the two mock routes.

## Evidence

10 tests pass; line coverage of `harness.mjs` 98.9% and of `mock-route.mjs` 100%. The numbers the mock routes produce
(score, latency, cost) are inputs of the tests, not measurements of any model.

## What did not run and why

No 60-item expert-signed tender set exists (the business must produce it, D07); no domestic API key; no self-hosted
model endpoint (needs a GPU or a domestic-hosted endpoint inside Vietnam); no international route. Therefore no quality,
latency or cost figure of a real model is recorded, and none should be quoted from this spike. The harness enforces the
expert signature field but cannot check that the expert exists.

## Decision

The harness is the proposed shape of the eval record; the LLM module should adopt `route`, `kind`, `items`, `pages`,
`score`, `p95LatencyMs`, `costPer1000Pages` or state its own shape (open question for the LLM group). Routing profile and
thresholds: **no proposal possible yet**. Owner: AI lead. To run it: obtain the signed dataset, implement one adapter per
route against the contract in `scripts/ai-eval/mock-route.mjs`, run `harness.mjs` per route, and record the table here.
