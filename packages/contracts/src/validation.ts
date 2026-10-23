/**
 * A small validator for the subset of JSON Schema that the request bodies of `openapi.json` use (the generator
 * refuses any other keyword, so a schema can never be validated more weakly than it is written). It reports
 * structured issues that carry a field path and never a value; mapping them to HTTP problems is the server's job.
 */
export interface Schema {
  $ref?: string;
  type?: string | string[];
  nullable?: boolean;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  oneOf?: Schema[];
  enum?: unknown[];
  pattern?: string;
  format?: string;
  contentEncoding?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export type SchemaTable = Readonly<Record<string, Schema>>;

/** `unknown_field`: not in the schema; `missing`: required and absent; `type`: wrong JSON type; `constraint`: right type, rule broken. */
export type IssueKind = 'unknown_field' | 'missing' | 'type' | 'constraint';

export interface Issue {
  kind: IssueKind;
  /** Property names joined by dots (array indices are left out); `body` for the root. */
  path: string;
}

export const ROOT_PATH = 'body';
const REF_PREFIX = '#/components/schemas/';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const patterns = new Map<string, RegExp>();

function patternOf(source: string): RegExp {
  let compiled = patterns.get(source);
  if (compiled === undefined) {
    compiled = new RegExp(source);
    patterns.set(source, compiled);
  }
  return compiled;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validDate(value: string): boolean {
  const match = DATE.exec(value);
  return match !== null && isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function validDateTime(value: string): boolean {
  const match = DATE_TIME.exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  // The numeric offset (absent for Z) must be a real offset: hours 00 to 23, minutes 00 to 59, so Date can parse what passes.
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  return (
    isCalendarDate(year ?? 0, month ?? 0, day ?? 0) &&
    (hour ?? 0) <= 23 &&
    (minute ?? 0) <= 59 &&
    (second ?? 0) <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

function formatHolds(format: string, value: string): boolean {
  switch (format) {
    case 'uuid':
      return UUID.test(value);
    case 'date':
      return validDate(value);
    case 'date-time':
      return validDateTime(value);
    default:
      // A format the schema names but this validator does not know is not enforced (the generator lists them).
      return true;
  }
}

function typesOf(schema: Schema): string[] {
  const declared = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  return schema.nullable === true ? [...declared, 'null'] : declared;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function child(path: string, key: string): string {
  return path === ROOT_PATH ? key : `${path}.${key}`;
}

function resolve(schema: Schema, table: SchemaTable): Schema {
  if (schema.$ref === undefined) return schema;
  const name = schema.$ref.startsWith(REF_PREFIX) ? schema.$ref.slice(REF_PREFIX.length) : schema.$ref;
  const target = table[name];
  if (target === undefined) throw new Error(`request schema ${name} is not in the schema table`);
  return target;
}

function scalarIssues(schema: Schema, value: unknown, path: string): Issue[] {
  const broken: Issue[] = [{ kind: 'constraint', path }];
  if (schema.enum !== undefined && !schema.enum.includes(value)) return broken;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return broken;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return broken;
    if (schema.pattern !== undefined && !patternOf(schema.pattern).test(value)) return broken;
    if (schema.format !== undefined && !formatHolds(schema.format, value)) return broken;
    if (schema.contentEncoding === 'base64' && !BASE64.test(value)) return broken;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return broken;
    if (schema.maximum !== undefined && value > schema.maximum) return broken;
  }
  return [];
}

function validateAt(schema: Schema, value: unknown, table: SchemaTable, path: string): Issue[] {
  const resolved = resolve(schema, table);
  if (resolved.oneOf !== undefined) {
    const matching = resolved.oneOf.filter((alternative) => validateAt(alternative, value, table, path).length === 0);
    return matching.length === 1 ? [] : [{ kind: 'constraint', path }];
  }
  const types = typesOf(resolved);
  if (types.length > 0 && !types.some((type) => matchesType(type, value))) return [{ kind: 'type', path }];
  if (value === null) return [];

  const issues: Issue[] = [];
  if (isObject(value) && (types.includes('object') || resolved.properties !== undefined)) {
    const properties = resolved.properties ?? {};
    if (resolved.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) issues.push({ kind: 'unknown_field', path: child(path, key) });
      }
    }
    for (const key of resolved.required ?? []) {
      if (value[key] === undefined) issues.push({ kind: 'missing', path: child(path, key) });
    }
    for (const [key, member] of Object.entries(value)) {
      if (member === undefined) continue;
      const memberSchema = Object.hasOwn(properties, key)
        ? properties[key]
        : typeof resolved.additionalProperties === 'object'
          ? resolved.additionalProperties
          : undefined;
      if (memberSchema !== undefined) issues.push(...validateAt(memberSchema, member, table, child(path, key)));
    }
    return issues;
  }
  if (Array.isArray(value)) {
    if (resolved.minItems !== undefined && value.length < resolved.minItems) issues.push({ kind: 'constraint', path });
    if (resolved.maxItems !== undefined && value.length > resolved.maxItems) issues.push({ kind: 'constraint', path });
    if (resolved.items !== undefined) {
      for (const item of value) issues.push(...validateAt(resolved.items, item, table, path));
    }
    return issues;
  }
  return scalarIssues(resolved, value, path);
}

/** Every issue of `value` against `schema`; `table` resolves `#/components/schemas/<Name>` references. */
export function validateValue(schema: Schema, value: unknown, table: SchemaTable): Issue[] {
  return validateAt(schema, value, table, ROOT_PATH);
}
