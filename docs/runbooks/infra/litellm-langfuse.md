# Runbook: LiteLLM and Langfuse

Story: ST-LLM-002. Declaration: `infra/components/litellm-langfuse.json`; alert rules `infra/alerts/litellm-langfuse.json`.

LiteLLM is the gateway to models; Langfuse records traces and cost. Only approved routes exist; a foreign model host
may receive PUBLIC data only, with an approved transfer assessment (`infra/policies/residency.json`).

## Entering use

The component stays `PLANNED` until `npm run infra:check -- --require-entered litellm-langfuse` passes: this runbook,
the alert rules and a restore test (restore the Langfuse database and show the route table loads from the repository).
See [README](README.md).

## Cost

Alert `llm-cost-spike`: daily spend is above 2 times the 7 day average.

1. Group the spend by tenant, route and feature in Langfuse.
2. A runaway loop shows as one feature with many calls; disable that route in the gateway, then fix the caller.
3. Report the spend to the tenant administrator if a tenant budget was exceeded.

## Routes

Alert `llm-route-errors`: the error rate of a route is above 5%.

1. Check the provider status and the credential reference after the last rotation.
2. Fail over to the next approved route only if the data class allows it; otherwise the feature degrades to its non-AI path.
