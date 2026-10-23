import { listOperations } from './openapi-document.ts';
import type { OpenApiDocument, OperationEntry } from './openapi-document.ts';

export type ChangeKind =
  | 'OPERATION_REMOVED'
  | 'OPERATION_MOVED'
  | 'PERMISSION_CHANGED'
  | 'REQUEST_BODY_REMOVED'
  | 'RESPONSE_REMOVED'
  | 'PARAMETER_REMOVED'
  | 'REQUIRED_PARAMETER_ADDED'
  | 'FIELD_REMOVED'
  | 'FIELD_RETYPED'
  | 'REQUIRED_FIELD_ADDED'
  | 'ENUM_TIGHTENED'
  | 'ENUM_EXTENDED';

/** One incompatible difference between two versions of the OpenAPI document. */
export interface Change {
  kind: ChangeKind;
  /** operationId of the affected operation. */
  operation: string;
  side?: 'request' | 'response';
  /** Dotted path of the field (`parent.label`, `items[]`), a `header:Name` parameter key or a status code. */
  location?: string;
  before?: string;
  after?: string;
  removed?: string[];
  added?: string[];
  /** One line for people. */
  summary: string;
}

type Side = 'request' | 'response';
type Node = Record<string, unknown>;

const JSON_MEDIA = 'application/json';
const MAX_DEPTH = 32;

interface Documents {
  previous: OpenApiDocument;
  current: OpenApiDocument;
}

interface Context {
  documents: Documents;
  operation: string;
  side: Side;
  changes: Change[];
  /** `previousRef|currentRef` pairs already compared on this side: guards cyclic schemas. */
  seen: Set<string>;
}

function asNode(value: unknown): Node | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Node) : undefined;
}

function refName(node: Node | undefined): string | undefined {
  const ref = node?.$ref;
  return typeof ref === 'string' ? ref : undefined;
}

// Follows a local $ref chain (`#/components/<section>/<name>`); an unknown reference resolves to undefined.
function resolve(doc: OpenApiDocument, value: unknown): Node | undefined {
  let node = asNode(value);
  for (let hops = 0; node !== undefined && refName(node) !== undefined && hops < MAX_DEPTH; hops += 1) {
    const parts = (refName(node) as string).replace(/^#\//, '').split('/');
    let target: unknown = doc;
    for (const part of parts) target = asNode(target)?.[part];
    node = asNode(target);
  }
  return refName(node) === undefined ? node : undefined;
}

function typeOf(schema: Node): string | undefined {
  const type = schema.type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.map(String).sort().join('|');
  return undefined;
}

function enumOf(schema: Node): string[] | undefined {
  return Array.isArray(schema.enum) ? schema.enum.map((value) => JSON.stringify(value)) : undefined;
}

function requiredOf(schema: Node): string[] {
  return Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : [];
}

function join(location: string, name: string): string {
  return location === '' ? name : `${location}.${name}`;
}

function record(context: Context, change: Omit<Change, 'operation' | 'side'>): void {
  context.changes.push({ operation: context.operation, side: context.side, ...change });
}

function compareSchema(context: Context, previous: unknown, current: unknown, location: string, depth: number): void {
  if (depth > MAX_DEPTH) return;
  const previousRef = refName(asNode(previous));
  const currentRef = refName(asNode(current));
  if (previousRef !== undefined && currentRef !== undefined) {
    const pair = `${context.side}|${previousRef}|${currentRef}`;
    if (context.seen.has(pair)) return;
    context.seen.add(pair);
  }
  const before = resolve(context.documents.previous, previous);
  const after = resolve(context.documents.current, current);
  if (before === undefined || after === undefined) return;
  const subject = location === '' ? '(body)' : location;

  const beforeType = typeOf(before);
  const afterType = typeOf(after);
  if (beforeType !== undefined && afterType !== undefined && beforeType !== afterType) {
    record(context, {
      kind: 'FIELD_RETYPED',
      location: subject,
      before: beforeType,
      after: afterType,
      summary: `${context.side} field ${subject} changed type from ${beforeType} to ${afterType}`,
    });
    return;
  }

  compareEnum(context, before, after, subject);
  compareProperties(context, before, after, location, depth);

  if (before.items !== undefined && after.items !== undefined) compareSchema(context, before.items, after.items, `${location}[]`, depth + 1);
  for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
    const left = before[keyword];
    const right = after[keyword];
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) continue;
    left.forEach((member, index) => compareSchema(context, member, right[index], location, depth + 1));
  }
}

function compareEnum(context: Context, before: Node, after: Node, subject: string): void {
  const left = enumOf(before);
  const right = enumOf(after);
  if (left === undefined || right === undefined) return;
  const removed = left.filter((value) => !right.includes(value));
  const added = right.filter((value) => !left.includes(value));
  if (context.side === 'request' && removed.length > 0) {
    record(context, { kind: 'ENUM_TIGHTENED', location: subject, removed, summary: `request field ${subject} no longer accepts ${removed.join(', ')}` });
  }
  if (context.side === 'response' && added.length > 0) {
    record(context, { kind: 'ENUM_EXTENDED', location: subject, added, summary: `response field ${subject} can now be ${added.join(', ')}` });
  }
}

function compareProperties(context: Context, before: Node, after: Node, location: string, depth: number): void {
  const left = asNode(before.properties) ?? {};
  const right = asNode(after.properties) ?? {};
  for (const name of Object.keys(left).sort()) {
    const path = join(location, name);
    if (!Object.hasOwn(right, name)) {
      record(context, { kind: 'FIELD_REMOVED', location: path, summary: `${context.side} field ${path} was removed` });
      continue;
    }
    compareSchema(context, left[name], right[name], path, depth + 1);
  }
  if (context.side !== 'request') return;
  const wasRequired = new Set(requiredOf(before));
  for (const name of requiredOf(after).sort()) {
    if (wasRequired.has(name)) continue;
    const path = join(location, name);
    record(context, { kind: 'REQUIRED_FIELD_ADDED', location: path, summary: `request field ${path} is now required` });
  }
}

function jsonSchemaOf(doc: OpenApiDocument, container: unknown): unknown {
  const content = asNode(asNode(resolve(doc, container))?.content);
  return asNode(content?.[JSON_MEDIA])?.schema;
}

function parametersOf(doc: OpenApiDocument, operation: Node): Map<string, { required: boolean; schema: unknown }> {
  const result = new Map<string, { required: boolean; schema: unknown }>();
  const list = Array.isArray(operation.parameters) ? operation.parameters : [];
  for (const entry of list) {
    const parameter = resolve(doc, entry);
    if (parameter === undefined || typeof parameter.name !== 'string' || typeof parameter.in !== 'string') continue;
    result.set(`${parameter.in}:${parameter.name}`, { required: parameter.required === true || parameter.in === 'path', schema: parameter.schema });
  }
  return result;
}

function compareParameters(context: Context, before: Node, after: Node): void {
  const left = parametersOf(context.documents.previous, before);
  const right = parametersOf(context.documents.current, after);
  for (const [key, parameter] of [...left.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const next = right.get(key);
    if (next === undefined) {
      record(context, { kind: 'PARAMETER_REMOVED', location: key, summary: `parameter ${key} was removed` });
      continue;
    }
    if (!parameter.required && next.required) {
      record(context, { kind: 'REQUIRED_PARAMETER_ADDED', location: key, summary: `parameter ${key} is now required` });
    }
    if (parameter.schema !== undefined && next.schema !== undefined) compareSchema(context, parameter.schema, next.schema, key, 0);
  }
  for (const [key, parameter] of [...right.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!left.has(key) && parameter.required) {
      record(context, { kind: 'REQUIRED_PARAMETER_ADDED', location: key, summary: `parameter ${key} is new and required` });
    }
  }
}

function compareResponses(context: Context, before: Node, after: Node): void {
  const left = asNode(before.responses) ?? {};
  const right = asNode(after.responses) ?? {};
  for (const status of Object.keys(left).sort()) {
    if (!status.startsWith('2')) continue;
    if (!Object.hasOwn(right, status)) {
      record(context, { kind: 'RESPONSE_REMOVED', location: status, summary: `success response ${status} was removed` });
      continue;
    }
    const previousSchema = jsonSchemaOf(context.documents.previous, left[status]);
    if (previousSchema === undefined) continue;
    const currentSchema = jsonSchemaOf(context.documents.current, right[status]);
    if (currentSchema === undefined) {
      record(context, { kind: 'RESPONSE_REMOVED', location: `${status}:${JSON_MEDIA}`, summary: `response ${status} no longer returns ${JSON_MEDIA}` });
      continue;
    }
    compareSchema(context, previousSchema, currentSchema, '', 0);
  }
}

function compareOperation(documents: Documents, previous: OperationEntry, current: OperationEntry, changes: Change[]): void {
  const before = previous.operation as Node;
  const after = current.operation as Node;
  const base = { documents, operation: previous.id, changes };
  if (previous.method !== current.method || previous.path !== current.path) {
    changes.push({
      kind: 'OPERATION_MOVED',
      operation: previous.id,
      before: `${previous.method.toUpperCase()} ${previous.path}`,
      after: `${current.method.toUpperCase()} ${current.path}`,
      summary: `operation ${previous.id} moved from ${previous.method.toUpperCase()} ${previous.path} to ${current.method.toUpperCase()} ${current.path}`,
    });
    return;
  }
  const beforePermission = before['x-permission'];
  const afterPermission = after['x-permission'];
  if (beforePermission !== afterPermission) {
    changes.push({
      kind: 'PERMISSION_CHANGED',
      operation: previous.id,
      before: String(beforePermission),
      after: String(afterPermission),
      summary: `operation ${previous.id} now needs ${String(afterPermission)} instead of ${String(beforePermission)}`,
    });
  }
  const requestContext: Context = { ...base, side: 'request', seen: new Set() };
  compareParameters(requestContext, before, after);
  const previousBody = jsonSchemaOf(documents.previous, before.requestBody);
  const currentBody = jsonSchemaOf(documents.current, after.requestBody);
  if (previousBody !== undefined && currentBody === undefined) {
    changes.push({ kind: 'REQUEST_BODY_REMOVED', operation: previous.id, side: 'request', summary: `operation ${previous.id} no longer takes a JSON request body` });
  } else if (previousBody !== undefined && currentBody !== undefined) {
    compareSchema(requestContext, previousBody, currentBody, '', 0);
  }
  compareResponses({ ...base, side: 'response', seen: new Set() }, before, after);
}

function order(a: Change, b: Change): number {
  return (
    a.operation.localeCompare(b.operation) ||
    a.kind.localeCompare(b.kind) ||
    (a.side ?? '').localeCompare(b.side ?? '') ||
    (a.location ?? '').localeCompare(b.location ?? '')
  );
}

/**
 * Differences between two versions of the API contract that break a client written against the previous one:
 * removed or moved operations, a changed permission, removed or retyped fields, request enums that lost a value,
 * response enums that gained one, new required request fields and parameters, removed success responses.
 * Additive changes are not reported. The result is sorted, so the same pair of documents gives the same report.
 */
export function breakingChanges(previous: OpenApiDocument, current: OpenApiDocument): Change[] {
  const documents: Documents = { previous, current };
  const currentById = new Map(listOperations(current).map((entry) => [entry.id, entry]));
  const changes: Change[] = [];
  for (const entry of listOperations(previous)) {
    const next = currentById.get(entry.id);
    if (next === undefined) {
      changes.push({ kind: 'OPERATION_REMOVED', operation: entry.id, summary: `operation ${entry.id} (${entry.method.toUpperCase()} ${entry.path}) was removed` });
      continue;
    }
    compareOperation(documents, entry, next, changes);
  }
  return changes.sort(order);
}
