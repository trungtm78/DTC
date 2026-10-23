import { REGISTER_MODES, SYMBOL_KINDS } from './types';
import type { Direction, RegisterMode, SymbolKind } from './types';

export const FIRST_YEAR = 2000;
export const LAST_YEAR = 2200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /\{([^{}]*)\}/g;
const ALLOWED_TOKENS = ['number', 'type', 'agency', 'unit'];
const LETTER_AFTER_NUMBER = /\{number\}[A-Za-z]/;

/** What a form field can be wrong with; the screen words each in the active language. */
export type FieldProblem = 'required' | 'tooShort' | 'tooLong' | 'date' | 'range' | 'pattern' | 'year';

export interface TypeValues {
  code: string;
  name: string;
  abbreviation: string;
  symbolKind: SymbolKind;
  symbolPattern: string;
  registerCode: string;
  legalBasis: string;
  effectiveFrom: string;
  effectiveUntil: string;
}

export const EMPTY_TYPE_VALUES: TypeValues = {
  code: '',
  name: '',
  abbreviation: '',
  symbolKind: SYMBOL_KINDS[0],
  symbolPattern: '',
  registerCode: '',
  legalBasis: '',
  effectiveFrom: '',
  effectiveUntil: '',
};

export type TypeField = keyof TypeValues;
export type TypeErrors = Partial<Record<TypeField, FieldProblem>>;

export interface RegisterValues {
  registerCode: string;
  name: string;
  direction: Direction;
  organizationUnitId: string;
  year: string;
  mode: RegisterMode;
  scopeDocTypes: string[];
}

export const EMPTY_REGISTER_VALUES: RegisterValues = {
  registerCode: '',
  name: '',
  direction: 'OUTGOING',
  organizationUnitId: '',
  year: '',
  mode: REGISTER_MODES[0],
  scopeDocTypes: [],
};

export type RegisterField = keyof RegisterValues;
export type RegisterErrors = Partial<Record<RegisterField, FieldProblem>>;

function length(value: string, min: number, max: number): FieldProblem | undefined {
  const size = value.trim().length;
  if (size === 0) return 'required';
  if (size < min) return 'tooShort';
  return size > max ? 'tooLong' : undefined;
}

/** The same rule as the server (BR-DOC-05): one `{number}`, only the known tokens, no letter right behind the number. */
export function symbolPatternProblem(pattern: string): FieldProblem | undefined {
  const tokens = [...pattern.matchAll(TOKEN)].map((match) => match[1] ?? '');
  const rest = pattern.replace(TOKEN, '');
  if (rest.includes('{') || rest.includes('}')) return 'pattern';
  if (tokens.some((token) => !ALLOWED_TOKENS.includes(token))) return 'pattern';
  if (tokens.filter((token) => token === 'number').length !== 1) return 'pattern';
  return LETTER_AFTER_NUMBER.test(pattern) ? 'pattern' : undefined;
}

export function validateTypeForm(values: TypeValues): TypeErrors {
  const errors: TypeErrors = {};
  const check = (field: TypeField, problem: FieldProblem | undefined): void => {
    if (problem !== undefined) errors[field] = problem;
  };
  check('code', length(values.code, 1, 20));
  check('name', length(values.name, 3, 200));
  if (values.abbreviation.trim() !== '') check('abbreviation', length(values.abbreviation, 1, 20));
  check('registerCode', length(values.registerCode, 2, 40));
  check('legalBasis', length(values.legalBasis, 3, 2000));
  const pattern = length(values.symbolPattern, 3, 200);
  check('symbolPattern', pattern ?? symbolPatternProblem(values.symbolPattern));
  check('effectiveFrom', DATE.test(values.effectiveFrom) ? undefined : values.effectiveFrom === '' ? 'required' : 'date');
  if (values.effectiveUntil !== '') {
    if (!DATE.test(values.effectiveUntil)) check('effectiveUntil', 'date');
    else if (errors.effectiveFrom === undefined && values.effectiveUntil <= values.effectiveFrom) check('effectiveUntil', 'range');
  }
  return errors;
}

export function validateRegisterForm(values: RegisterValues): RegisterErrors {
  const errors: RegisterErrors = {};
  const check = (field: RegisterField, problem: FieldProblem | undefined): void => {
    if (problem !== undefined) errors[field] = problem;
  };
  check('registerCode', length(values.registerCode, 2, 40));
  check('name', length(values.name, 3, 200));
  if (values.organizationUnitId === '') check('organizationUnitId', 'required');
  const year = Number(values.year);
  check('year', values.year.trim() === '' ? 'required' : Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR ? undefined : 'year');
  return errors;
}

export interface TypeBody {
  code: string;
  name: string;
  abbreviation?: string;
  symbol_kind: SymbolKind;
  symbol_pattern: string;
  register_code: string;
  legal_basis: string;
  effective_from: string;
  effective_until?: string;
}

export function typeBody(values: TypeValues): TypeBody {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    ...(values.abbreviation.trim() === '' ? {} : { abbreviation: values.abbreviation.trim() }),
    symbol_kind: values.symbolKind,
    symbol_pattern: values.symbolPattern.trim(),
    register_code: values.registerCode.trim(),
    legal_basis: values.legalBasis.trim(),
    effective_from: values.effectiveFrom,
    ...(values.effectiveUntil === '' ? {} : { effective_until: values.effectiveUntil }),
  };
}

export interface RegisterBody {
  register_code: string;
  name: string;
  direction: Direction;
  organization_unit_id: string;
  year: number;
  mode: RegisterMode;
  scope_doc_types: string[];
}

export function registerBody(values: RegisterValues): RegisterBody {
  return {
    register_code: values.registerCode.trim(),
    name: values.name.trim(),
    direction: values.direction,
    organization_unit_id: values.organizationUnitId,
    year: Number(values.year),
    mode: values.mode,
    scope_doc_types: values.scopeDocTypes,
  };
}

export const CLOSE_REASON_MIN = 10;
export const CLOSE_REASON_MAX = 500;

export function closeReasonProblem(reason: string): FieldProblem | undefined {
  return length(reason, CLOSE_REASON_MIN, CLOSE_REASON_MAX);
}
