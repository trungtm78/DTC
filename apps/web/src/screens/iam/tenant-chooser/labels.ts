import { ApiError } from '@machvon/api-client';
import type { Translator } from '../../../i18n';
import type { Selectability } from './candidate-model';

type T = Translator['t'];

/** The kind of membership; each key is written out so the i18n check can see it is in use. */
export function membershipTypeLabel(t: T, type: string): string {
  switch (type) {
    case 'STAFF':
      return t('iam.tenantChooser.type.staff.label');
    case 'GUEST_CONTRACTOR':
      return t('iam.tenantChooser.type.guest.label');
    case 'SERVICE_ACCOUNT':
      return t('iam.tenantChooser.type.service.label');
    default:
      return t('iam.tenantChooser.type.other.label');
  }
}

export function tenantStatusLabel(t: T, status: string): string {
  switch (status) {
    case 'Active':
      return t('iam.tenantChooser.tenantStatus.active.label');
    case 'Suspended':
      return t('iam.tenantChooser.tenantStatus.suspended.label');
    default:
      return t('iam.tenantChooser.tenantStatus.other.label');
  }
}

/** The note under a card that cannot be chosen plainly; a plainly selectable card has none. */
export function noteOf(t: T, selectability: Selectability): string | undefined {
  switch (selectability) {
    case 'readOnly':
      return t('iam.tenantChooser.readOnly.note');
    case 'inactive':
      return t('iam.tenantChooser.inactive.note');
    case 'unavailable':
      return t('iam.tenantChooser.unavailable.note');
    case 'selectable':
      return undefined;
  }
}

/** What the server refused with, in the person's words; the refusal never names another tenant. */
export function problemMessage(t: T, failure: unknown): string {
  if (failure instanceof ApiError) {
    switch (failure.code) {
      case 'TENANT_SELECTION_INVALID':
        return t('iam.tenantChooser.error.invalid');
      case 'MEMBERSHIP_INACTIVE':
        return t('iam.tenantChooser.error.inactive');
      case 'TENANT_SUSPENDED':
        return t('iam.tenantChooser.error.suspended');
    }
  }
  return t('iam.tenantChooser.error.generic');
}
