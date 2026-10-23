# OUTBOX_EVENT_DEAD

**Owner:** platform-oncall · **Severity:** critical · **Rule:** `alerts/rules/OUTBOX_EVENT_DEAD.json`

## What it means

The event is marked DEAD and no consumer will receive it; the owner of the event type must decide what happens to it.

## What to do

1. Find the event by the id in the alert context (`outbox_event`, status DEAD) and read its `type` and `attempts`.
2. Fix the cause (unregistered type, payload that breaks its schema, consumer bug), then requeue the event through the operations tool.
3. Never edit the payload to make it pass: raise a change to the event schema instead.
