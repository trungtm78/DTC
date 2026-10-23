import { createHash } from 'node:crypto';
import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ControlDatabase } from '@machvon/db';
import { DomainError } from '@machvon/kernel';

export interface EventTypeDefinition {
  eventType: string;
  schemaVersion: number;
  payloadSchema: unknown;
  allowedPurposes: readonly string[];
  status: 'Active' | 'Deprecated';
}

/** The registered event types (BR-NOT-15): owned by the source modules, seeded by their migrations. */
export interface EventTypeCatalog {
  get(eventType: string, schemaVersion: number): Promise<EventTypeDefinition | undefined>;
}

const CACHE_MILLISECONDS = 60_000;

interface CatalogRow {
  event_type: string;
  schema_version: number;
  payload_schema: unknown;
  allowed_purposes: string[];
  status: 'Active' | 'Deprecated';
}

/** Reads `notification_event_type`, a control-plane table, through the control handle; entries are cached for 60 seconds. */
export class ControlEventTypeCatalog implements EventTypeCatalog {
  private readonly entries = new Map<string, { loadedAt: number; definition: EventTypeDefinition | undefined }>();

  constructor(
    private readonly control: ControlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  async get(eventType: string, schemaVersion: number): Promise<EventTypeDefinition | undefined> {
    const key = `${eventType}@${schemaVersion}`;
    const cached = this.entries.get(key);
    if (cached !== undefined && this.now() - cached.loadedAt < CACHE_MILLISECONDS) return cached.definition;
    const [row] = await this.control.withControl((tx) =>
      tx.query<CatalogRow>(
        'select event_type, schema_version, payload_schema, allowed_purposes, status from machvon.notification_event_type where event_type = $1 and schema_version = $2',
        [eventType, schemaVersion],
      ),
    );
    const definition: EventTypeDefinition | undefined =
      row === undefined
        ? undefined
        : { eventType: row.event_type, schemaVersion: row.schema_version, payloadSchema: row.payload_schema, allowedPurposes: row.allowed_purposes, status: row.status };
    this.entries.set(key, { loadedAt: this.now(), definition });
    return definition;
  }
}

// The formats event schemas use; strict mode is off so an unknown format is ignored rather than failing a delivery.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

function digestOf(schema: unknown): string {
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}

/**
 * Checks an event payload against the `payload_schema` of its registered type (NOT 3.1 step 1). An unregistered or
 * deprecated type is refused with 422 EVENT_TYPE_UNKNOWN and a payload that breaks its schema with 422
 * VALIDATION_FAILED naming the failing path, never a value: the relay retries and finally marks the delivery DEAD.
 * Schemas are JSON Schema 2020-12 (docs/notification-event-types.md).
 */
export class PayloadValidator {
  private readonly ajv = new Ajv2020({ strict: false, logger: false });
  private readonly compiled = new Map<string, { digest: string; schema: object; validate: ValidateFunction }>();

  constructor(private readonly catalog: EventTypeCatalog) {
    this.ajv.addFormat('uuid', UUID);
    this.ajv.addFormat('date', DATE);
    this.ajv.addFormat('date-time', DATE_TIME);
  }

  async validate(eventType: string, schemaVersion: number, payload: unknown): Promise<EventTypeDefinition> {
    const definition = await this.catalog.get(eventType, schemaVersion);
    if (definition === undefined || definition.status !== 'Active') throw new DomainError('EVENT_TYPE_UNKNOWN', 422);
    const validate = this.validatorFor(definition);
    if (!validate(payload)) {
      const path = validate.errors?.[0]?.instancePath ?? '';
      throw new DomainError('VALIDATION_FAILED', 422, `payload${path}`);
    }
    return definition;
  }

  private validatorFor(definition: EventTypeDefinition): ValidateFunction {
    const key = `${definition.eventType}@${definition.schemaVersion}`;
    const cached = this.compiled.get(key);
    // The catalogue refresh builds a new object every 60 seconds, so equality is by content. A schema that really
    // changed is compiled again, after the old one (and its $id) left the Ajv registry.
    const digest = digestOf(definition.payloadSchema);
    if (cached !== undefined && cached.digest === digest) return cached.validate;
    if (cached !== undefined) this.ajv.removeSchema(cached.schema);
    const schema = definition.payloadSchema as object;
    const validate = this.ajv.compile(schema);
    this.compiled.set(key, { digest, schema, validate });
    return validate;
  }
}
