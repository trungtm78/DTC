import type { CommandInput } from '@machvon/api-client';
import { GOVERNING_BODY_TYPES, ISOLATION_MODES, REGIONS } from './types';

/** BR-SAS-01: a tenant code is unique forever; the registry compares it case-insensitively. */
export const TENANT_CODE_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;
export const SUBDOMAIN_PATTERN = /^[a-z0-9-]{3,40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROVISION_FIELDS = [
  'code',
  'name',
  'governing_body_type',
  'administrative_code',
  'region',
  'isolation_mode',
  'plan_version_id',
  'root_unit_name',
  'initial_owner_email',
  'platform_subdomain',
  'procurement_contract_ref',
] as const;
export type ProvisionField = (typeof PROVISION_FIELDS)[number];

export interface ProvisionValues {
  code: string;
  name: string;
  governing_body_type: string;
  administrative_code: string;
  region: string;
  isolation_mode: string;
  plan_version_id: string;
  root_unit_name: string;
  initial_owner_email: string;
  platform_subdomain: string;
  procurement_contract_ref: string;
}

export const EMPTY_PROVISION_VALUES: ProvisionValues = {
  code: '',
  name: '',
  governing_body_type: 'PROVINCE',
  administrative_code: '',
  region: 'vn-north',
  isolation_mode: 'POOL',
  plan_version_id: '',
  root_unit_name: '',
  initial_owner_email: '',
  platform_subdomain: '',
  procurement_contract_ref: '',
};

/** Why a field is refused before anything is sent; the screen turns each reason into its own words. */
export type FieldProblem = 'required' | 'pattern' | 'tooShort' | 'tooLong' | 'email' | 'uuid' | 'choice';

export type ProvisionErrors = Partial<Record<ProvisionField, FieldProblem>>;

const requireText = (value: string, minLength: number, maxLength: number | undefined): FieldProblem | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') return 'required';
  if (trimmed.length < minLength) return 'tooShort';
  if (maxLength !== undefined && trimmed.length > maxLength) return 'tooLong';
  return undefined;
};

/** The same rules as `TenantProvisionRequest`, applied to the form so a bad value never leaves the browser. */
export function validateProvisionForm(values: ProvisionValues): ProvisionErrors {
  const errors: ProvisionErrors = {};
  const set = (field: ProvisionField, problem: FieldProblem | undefined): void => {
    if (problem !== undefined) errors[field] = problem;
  };
  set('code', values.code === '' ? 'required' : TENANT_CODE_PATTERN.test(values.code) ? undefined : 'pattern');
  set('name', requireText(values.name, 3, 255));
  set('governing_body_type', (GOVERNING_BODY_TYPES as readonly string[]).includes(values.governing_body_type) ? undefined : 'choice');
  set('administrative_code', values.administrative_code.length > 20 ? 'tooLong' : undefined);
  set('region', (REGIONS as readonly string[]).includes(values.region) ? undefined : 'choice');
  set('isolation_mode', (ISOLATION_MODES as readonly string[]).includes(values.isolation_mode) ? undefined : 'choice');
  set('plan_version_id', values.plan_version_id.trim() === '' ? 'required' : UUID_PATTERN.test(values.plan_version_id.trim()) ? undefined : 'uuid');
  set('root_unit_name', requireText(values.root_unit_name, 3, undefined));
  set('initial_owner_email', values.initial_owner_email.trim() === '' ? 'required' : EMAIL_PATTERN.test(values.initial_owner_email.trim()) ? undefined : 'email');
  set('platform_subdomain', values.platform_subdomain === '' ? 'required' : SUBDOMAIN_PATTERN.test(values.platform_subdomain) ? undefined : 'pattern');
  return errors;
}

export type TenantProvisionBody = NonNullable<CommandInput<'requestTenantProvisioning'>['body']>;

/** The request body for the form: trimmed text, optional fields left out when empty. */
export function provisionBody(values: ProvisionValues): TenantProvisionBody {
  const body = {
    code: values.code,
    name: values.name.trim(),
    governing_body_type: values.governing_body_type,
    region: values.region,
    isolation_mode: values.isolation_mode,
    plan_version_id: values.plan_version_id.trim(),
    root_unit_name: values.root_unit_name.trim(),
    initial_owner_email: values.initial_owner_email.trim(),
    platform_subdomain: values.platform_subdomain,
  } as TenantProvisionBody;
  if (values.administrative_code.trim() !== '') body.administrative_code = values.administrative_code.trim();
  if (values.procurement_contract_ref.trim() !== '') body.procurement_contract_ref = values.procurement_contract_ref.trim();
  return body;
}
