import { DomainError, asUuid, assertAllowedFields } from '@machvon/kernel';

export interface OrgUnitCreateDto {
  code: string;
  name: string;
  parentId: string;
  unitType: string;
  validFrom: string;
  isInvestor?: boolean;
  administrativeCode?: string;
  legalBasisRef?: string;
}

export interface OrgUnitUpdateDto {
  code?: string;
  name?: string;
  isInvestor?: boolean;
  administrativeCode?: string;
  legalBasisRef?: string;
}

export interface OrgUnitMoveDto {
  newParentId: string;
  effectiveFrom: string;
  reason: string;
}

const CODE = /^[A-Z0-9_.-]{2,40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNIT_TYPES = ['DEPARTMENT', 'PROJECT_MANAGEMENT_BOARD', 'INVESTOR', 'COMMUNE', 'DIVISION', 'OTHER'];
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

// Structure problems (wrong type, missing field) are 400 INVALID_REQUEST; a well typed value that breaks a format or
// length rule is 422 VALIDATION_FAILED. The detail names the field, never its value.
const malformed = (field: string): DomainError => new DomainError('INVALID_REQUEST', 400, field);
const rejected = (field: string): DomainError => new DomainError('VALIDATION_FAILED', 422, field);

function record(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw malformed('body');
  return body as Record<string, unknown>;
}

function text(source: Record<string, unknown>, field: string, min: number, max: number): string {
  const value = source[field];
  if (typeof value !== 'string') throw malformed(field);
  if (value.length < min || value.length > max) throw rejected(field);
  return value;
}

function optionalText(source: Record<string, unknown>, field: string, max: number): string | undefined {
  return source[field] === undefined ? undefined : text(source, field, 0, max);
}

function uuid(source: Record<string, unknown>, field: string): string {
  if (typeof source[field] !== 'string') throw malformed(field);
  const parsed = asUuid(source[field]);
  if (parsed === undefined) throw rejected(field);
  return parsed;
}

/** A real calendar date in YYYY-MM-DD form. */
function isoDate(source: Record<string, unknown>, field: string): string {
  const value = text(source, field, 0, 10);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!ISO_DATE.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw rejected(field);
  return value;
}

function code(source: Record<string, unknown>): string {
  const value = text(source, 'code', 0, 40);
  if (!CODE.test(value)) throw rejected('code');
  return value;
}

function name(source: Record<string, unknown>): string {
  return text(source, 'name', 2, 255);
}

function flag(source: Record<string, unknown>, field: string): boolean | undefined {
  if (source[field] === undefined) return undefined;
  if (typeof source[field] !== 'boolean') throw malformed(field);
  return source[field];
}

export function parseOrgUnitCreate(body: unknown): OrgUnitCreateDto {
  const source = record(body);
  assertAllowedFields<Record<string, unknown>>(source, ['code', 'name', 'parent_id', 'unit_type', 'is_investor', 'administrative_code', 'valid_from', 'legal_basis_ref']);
  const unitType = text(source, 'unit_type', 0, 40);
  if (!UNIT_TYPES.includes(unitType)) throw rejected('unit_type');
  return {
    code: code(source),
    name: name(source),
    parentId: uuid(source, 'parent_id'),
    unitType,
    validFrom: isoDate(source, 'valid_from'),
    isInvestor: flag(source, 'is_investor'),
    administrativeCode: optionalText(source, 'administrative_code', 20),
    legalBasisRef: optionalText(source, 'legal_basis_ref', 255),
  };
}

export function parseOrgUnitUpdate(body: unknown): OrgUnitUpdateDto {
  const source = record(body);
  assertAllowedFields<Record<string, unknown>>(source, ['code', 'name', 'is_investor', 'administrative_code', 'legal_basis_ref']);
  return {
    code: source.code === undefined ? undefined : code(source),
    name: source.name === undefined ? undefined : name(source),
    isInvestor: flag(source, 'is_investor'),
    administrativeCode: optionalText(source, 'administrative_code', 20),
    legalBasisRef: optionalText(source, 'legal_basis_ref', 255),
  };
}

/** Today in Vietnam, as YYYY-MM-DD. */
export function todayInVietnam(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: VIETNAM_TIME_ZONE });
}

/**
 * A move takes effect when it is made: the tree keeps one current shape, and moves dated in the future belong to
 * the reorganisation saga (BR-IAM-10), so a future `effective_from` is refused.
 */
export function parseOrgUnitMove(body: unknown, today: string = todayInVietnam()): OrgUnitMoveDto {
  const source = record(body);
  assertAllowedFields<Record<string, unknown>>(source, ['new_parent_id', 'effective_from', 'reason']);
  const effectiveFrom = isoDate(source, 'effective_from');
  if (effectiveFrom > today) throw rejected('effective_from');
  return { newParentId: uuid(source, 'new_parent_id'), effectiveFrom, reason: text(source, 'reason', 10, 2000) };
}
