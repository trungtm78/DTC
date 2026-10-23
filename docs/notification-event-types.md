# Registering a notification event type

Module owners register the events that should reach people as in-app notifications. A module emits an ordinary
outbox event (`enqueueOutbox`); the notification core turns it into notifications. Nothing in a module calls a
notification API, and a failing notification never fails the module's command (BR-NOT-16).

## 1. Register the event type (migration of the owning module)

Insert one row per type and schema version into `notification_event_type` (control plane; the table has no tenant):

| Column | Meaning |
|---|---|
| `event_type` | Stable name in the module's namespace, for example `prj.stage.changed`; it is also the outbox `type` |
| `schema_version` | Starts at 1; a breaking change adds a new row, the old one is set to `Deprecated` |
| `owning_module` | Module code (`PRJ`, `CTR`, ...) that is told when a delivery of the type goes `DEAD` |
| `payload_schema` | JSON Schema (draft 2020-12 subset supported by Ajv 8) the outbox payload must satisfy |
| `allowed_purposes` | Subset of `OPERATIONAL`, `SECURITY`, `REMINDER`, `ANNOUNCEMENT`, `DIGEST`, `SUPPORT_CONVERSATION` (BR-NOT-02) |
| `data_classification` | `PUBLIC`, `INTERNAL`, `CONFIDENTIAL` or `PERSONAL`: it decides which channels may ever carry the content |
| `status` | `Active`; only `Active` types are accepted (BR-NOT-15) |

An unregistered or `Deprecated` type is refused with 422 `EVENT_TYPE_UNKNOWN`, a payload that breaks its schema with
422 `VALIDATION_FAILED` naming the failing path (never a value). The relay retries such a delivery and finally marks it
`DEAD`, which raises `OUTBOX_EVENT_DEAD` to the owning module.

## 2. Say what the notification is about (the `notification` member of the payload)

```json
{
  "notification": {
    "resource": { "type": "project", "id": "<uuid>", "ownerUnitId": "<uuid>", "ownerUnitPath": "/root/unit/" },
    "deepLink": "/prj/prj-01/<uuid>",
    "recipients": ["<membership uuid>"]
  }
}
```

- `resource.type` and `resource.id` are required when the notification is about a record. A recipient is notified, and
  later sees the content, only while they hold `<type>.read` (on a grant whose scope contains `ownerUnitId` and
  `ownerUnitPath` when those are given). Without access the inbox shows "content unavailable" and nothing of the record.
- `deepLink` is an opaque reference, never a URL with business data in it. Opening it checks access again.
- `recipients` lists membership ids for a workflow whose resolver is `explicit`. Memberships that are not `Active`, that
  belong to another tenant or that lack read access are dropped (counted as `notification_suppressed_total{reason=no_access}`).
- The payload must not hold data the recipient cannot see: the notification stores no copy of it.

## 3. The workflow decides who, how urgent and for how long

Each tenant has one `Published` `workflow_version` of kind `NOTIFICATION` per event type. Its `definition_json`:

| Key | Default | Meaning |
|---|---|---|
| `resolver` | `{ "kind": "explicit" }` | `explicit` (ids from the payload) or `{ "kind": "role-in-scope", "roles": ["CODE", ...] }` (members holding one of the roles with a grant whose scope contains the resource's owner unit, project or contract) |
| `priority` | `NORMAL` | `CRITICAL`, `HIGH`, `NORMAL`, `LOW` |
| `ackRequired` | `false` | The recipient must acknowledge after reading (BR-NOT-05) |
| `expiresAfterMinutes` | `10080` | `expires_at = event time + this`; acknowledging after it is 409 `NOTIFICATION_EXPIRED` |
| `purpose` | `OPERATIONAL` | Must be in the event type's `allowed_purposes` |

With no `Published` workflow the event is consumed and no notification is created (`notification_no_workflow_total`).

## 4. Guarantees the module can rely on

- At most one notification per (event, recipient, purpose): the key is `n1:` + `sha256(tenant | event | recipient | purpose)`,
  so redeliveries, consumer crashes and replays after the workflow changed create nothing new.
- Delivery is at least once; the consumer is idempotent per event id and tenant context is verified from the relay's
  signed context, never from the event's own `tenantId`.
- Read is not acknowledge: `markNotificationRead` sets `read_at`; only `acknowledgeNotification` (when `ackRequired`)
  sets `acknowledged_at` and emits `not.notification.acknowledged.v1` (payload: `notification_id`, `recipient_id`,
  `acknowledged_at`, optional `comment`).

## 5. Checklist for a new event type

1. Migration with the `notification_event_type` row and a payload schema test (valid and broken payloads).
2. The command that emits the event writes the `notification` member as above, in the same transaction (outbox).
3. A test that delivers the event to the consumer and asserts the recipients, the "content unavailable" case and one
   redelivery.
4. The tenant workflow definition (seeded or configured) names the resolver, priority, acknowledgement and expiry.
