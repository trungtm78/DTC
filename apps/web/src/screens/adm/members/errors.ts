import { ApiError, NETWORK_ERROR_CODE } from '@machvon/api-client';
import type { Translator } from '../../../i18n';

/**
 * The user-facing message of a failed command or read of the member screens. Only the stable error code decides the
 * wording; whatever text the server sent never reaches the screen. Each key is written out so the i18n check can see
 * it is in use.
 */
export function errorMessage(t: Translator['t'], error: unknown): string {
  if (!(error instanceof ApiError)) return t('adm.members.error.generic');
  switch (error.code) {
    case 'MEMBERSHIP_EXISTS':
      return t('adm.members.error.membershipExists');
    case 'MEMBERSHIP_STATE_INVALID':
      return t('adm.members.error.stateInvalid');
    case 'QUOTA_EXCEEDED':
      return t('adm.members.error.quotaExceeded');
    case 'LAST_TENANT_OWNER':
      return t('adm.members.error.lastOwner');
    case 'SELF_ACTION_DENIED':
      return t('adm.members.error.selfAction');
    case 'ROLE_ESCALATION_DENIED':
    case 'SCOPE_OUT_OF_GRANTOR_RANGE':
    case 'SELF_GRANT_DENIED':
    case 'SYSTEM_PERMISSION_NOT_GRANTABLE':
      return t('adm.members.error.escalation');
    case 'GUEST_SCOPE_INVALID':
      return t('adm.members.error.guestScope');
    case 'CONTRACT_NOT_ACTIVE':
      return t('adm.members.error.contractNotActive');
    case 'VERSION_CONFLICT':
      return t('adm.members.error.versionConflict');
    case 'SCOPE_DENIED':
    case 'ENTITLEMENT_DENIED':
      return t('adm.members.error.denied');
    case 'RESOURCE_NOT_FOUND':
      return t('adm.members.error.notFound');
    case 'VALIDATION_FAILED':
    case 'INVALID_REQUEST':
    case 'FIELD_NOT_ALLOWED':
      return t('adm.members.error.invalid');
    case 'SESSION_EXPIRED':
      return t('adm.members.error.session');
    case NETWORK_ERROR_CODE:
      return t('adm.members.error.network');
    default:
      return t('adm.members.error.generic');
  }
}

/** The request field a problem names in its `detail` (for example `valid_until`), so the field can be marked invalid. */
export function offendingField(error: unknown): string | undefined {
  return error instanceof ApiError ? error.detail : undefined;
}

/** A stale version: the screen offers a reload instead of a retry. */
export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'VERSION_CONFLICT';
}
