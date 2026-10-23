import type { CommandInput } from '@machvon/api-client';
import { EDITIONS } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEASE_DAYS = 30;

export const ISSUE_FIELDS = ['tenant_id', 'entitlement_version_id', 'edition', 'seats', 'valid_from', 'valid_until', 'grace_until', 'deployment_binding', 'offline_lease_days'] as const;
export type IssueField = (typeof ISSUE_FIELDS)[number];

/** What the person types; the entitlement version is not typed, it is the current one of the chosen tenant. */
export interface IssueValues {
  tenant_id: string;
  edition: string;
  seats: string;
  valid_from: string;
  valid_until: string;
  grace_until: string;
  deployment_binding: string;
  offline_lease_days: string;
}

export const EMPTY_ISSUE_VALUES: IssueValues = {
  tenant_id: '',
  edition: 'STANDARD',
  seats: '',
  valid_from: '',
  valid_until: '',
  grace_until: '',
  deployment_binding: '',
  offline_lease_days: '',
};

/** Why a field is refused before anything is sent (BR-SAS-11); the screen turns each reason into its own words. */
export type FieldProblem = 'required' | 'uuid' | 'choice' | 'seats' | 'date' | 'window' | 'grace' | 'past' | 'lease' | 'entitlement';

export type IssueErrors = Partial<Record<IssueField, FieldProblem>>;

const isDate = (value: string): boolean => DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
const instant = (value: string): number => Date.parse(`${value}T00:00:00.000Z`);

/**
 * The rules of BR-SAS-11 and `LicenseIssue`, applied to the form so a bad window never leaves the browser:
 * `valid_from < valid_until <= grace_until`, a window that has not ended, seats of at least one, and an offline lease
 * (private deployments only) of 0 to 30 days.
 */
export function validateIssueForm(values: IssueValues, entitlementVersionId: string | undefined, now: Date): IssueErrors {
  const errors: IssueErrors = {};
  if (values.tenant_id === '') errors.tenant_id = 'required';
  else if (!UUID_PATTERN.test(values.tenant_id)) errors.tenant_id = 'uuid';
  if (values.tenant_id !== '' && entitlementVersionId === undefined) errors.entitlement_version_id = 'entitlement';
  if (!(EDITIONS as readonly string[]).includes(values.edition)) errors.edition = 'choice';
  if (values.seats.trim() !== '' && !/^[1-9]\d*$/.test(values.seats.trim())) errors.seats = 'seats';
  for (const field of ['valid_from', 'valid_until', 'grace_until'] as const) {
    if (values[field] === '') errors[field] = 'required';
    else if (!isDate(values[field])) errors[field] = 'date';
  }
  if (errors.valid_from === undefined && errors.valid_until === undefined && instant(values.valid_from) >= instant(values.valid_until)) errors.valid_until = 'window';
  if (errors.valid_until === undefined && instant(values.valid_until) <= now.getTime()) errors.valid_until = 'past';
  if (errors.valid_until === undefined && errors.grace_until === undefined && instant(values.grace_until) < instant(values.valid_until)) errors.grace_until = 'grace';
  if (values.edition === 'PRIVATE' && values.offline_lease_days.trim() !== '') {
    const days = Number(values.offline_lease_days.trim());
    if (!Number.isInteger(days) || days < 0 || days > MAX_LEASE_DAYS) errors.offline_lease_days = 'lease';
  }
  return errors;
}

export type LicenseIssueBody = NonNullable<CommandInput<'post_licenses'>['body']>;

/** The request body: dates at the start of the day in UTC, private-deployment fields only for the PRIVATE edition, optional fields left out when empty. */
export function issueBody(values: IssueValues, entitlementVersionId: string): LicenseIssueBody {
  const body = {
    tenant_id: values.tenant_id,
    edition: values.edition,
    valid_from: `${values.valid_from}T00:00:00.000Z`,
    valid_until: `${values.valid_until}T00:00:00.000Z`,
    grace_until: `${values.grace_until}T00:00:00.000Z`,
    entitlement_version_id: entitlementVersionId,
  } as LicenseIssueBody;
  if (values.seats.trim() !== '') body.seats = Number(values.seats.trim());
  if (values.edition === 'PRIVATE') {
    if (values.deployment_binding.trim() !== '') body.deployment_binding = values.deployment_binding.trim();
    if (values.offline_lease_days.trim() !== '') body.offline_lease_days = Number(values.offline_lease_days.trim());
  }
  return body;
}

/** The changes of state a license allows to a person who may manage licenses (SAS 4): a live license is suspended or revoked, a suspended one is reinstated or revoked. */
export type LicenseAction = 'suspend' | 'reinstate' | 'revoke';

export function licenseActions(status: string, canManage: boolean): LicenseAction[] {
  if (!canManage) return [];
  if (status === 'Scheduled' || status === 'Active' || status === 'Grace') return ['suspend', 'revoke'];
  if (status === 'Suspended') return ['reinstate', 'revoke'];
  return [];
}

export function isLicenseAction(value: string): value is LicenseAction {
  return value === 'suspend' || value === 'reinstate' || value === 'revoke';
}

export { isReasonValid } from '../tenant-detail/rules';
