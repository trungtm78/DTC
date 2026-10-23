/** The unit types of OrgUnitCreate (openapi.json). */
export const UNIT_TYPES = ['DEPARTMENT', 'PROJECT_MANAGEMENT_BOARD', 'INVESTOR', 'COMMUNE', 'DIVISION', 'OTHER'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** The permission the unit commands need (x-permission of createOrganizationUnit, updateOrganizationUnit, moveOrganizationUnit). */
export const MANAGE_UNITS_PERMISSION = 'iam.unit.manage';

/** One organisation unit as `get_resources_organization_unit` returns it. */
export interface OrgUnit {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  valid_from: string;
  valid_until: string | null;
  unit_type: string;
  administrative_code: string | null;
  is_investor: boolean;
  legal_basis_ref: string | null;
  status: string;
  successor_id: string | null;
  depth: number;
  version: number;
}

/** The form fields a problem can name (`detail` of the Problem+JSON body carries the field). */
export const FORM_FIELDS = [
  'code',
  'name',
  'parent_id',
  'unit_type',
  'valid_from',
  'is_investor',
  'administrative_code',
  'legal_basis_ref',
  'new_parent_id',
  'effective_from',
  'reason',
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

const STRING_KEYS = ['id', 'code', 'name', 'valid_from', 'unit_type', 'status'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Narrows the rows of a list answer (the contract types them as plain objects); rows that lack the identity of a unit are dropped. */
export function toOrgUnits(rows: readonly unknown[]): OrgUnit[] {
  const units: OrgUnit[] = [];
  for (const row of rows) {
    if (!isRecord(row) || STRING_KEYS.some((key) => typeof row[key] !== 'string')) continue;
    units.push({
      id: row.id as string,
      code: row.code as string,
      name: row.name as string,
      parent_id: nullableString(row.parent_id),
      valid_from: row.valid_from as string,
      valid_until: nullableString(row.valid_until),
      unit_type: row.unit_type as string,
      administrative_code: nullableString(row.administrative_code),
      is_investor: row.is_investor === true,
      legal_basis_ref: nullableString(row.legal_basis_ref),
      status: row.status as string,
      successor_id: nullableString(row.successor_id),
      depth: typeof row.depth === 'number' ? row.depth : 0,
      version: typeof row.version === 'number' ? row.version : 1,
    });
  }
  return units;
}
