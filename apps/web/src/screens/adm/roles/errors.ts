import { ApiError, NETWORK_ERROR_CODE } from '@machvon/api-client';
import type { Translator } from '../../../i18n';

export const MFA_REQUIRED = 'MFA_REQUIRED';

/** True when the server wants the second factor before it will run the command. */
export function isStepUpRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === MFA_REQUIRED;
}

/**
 * The user-facing message of a failed command or read. Only the stable error code decides the wording; whatever
 * text the server sent never reaches the screen. Each key is written out so the i18n check can see it is in use.
 */
export function errorMessage(t: Translator['t'], error: unknown): string {
  if (!(error instanceof ApiError)) return t('adm.roles.error.generic');
  switch (error.code) {
    case 'ROLE_ESCALATION_DENIED':
      return t('adm.roles.error.roleEscalationDenied');
    case 'SELF_GRANT_DENIED':
      return t('adm.roles.error.selfGrantDenied');
    case 'SCOPE_OUT_OF_GRANTOR_RANGE':
      return t('adm.roles.error.scopeOutOfRange');
    case 'SYSTEM_PERMISSION_NOT_GRANTABLE':
      return t('adm.roles.error.systemPermission');
    case 'GUEST_SCOPE_INVALID':
      return t('adm.roles.error.guestScopeInvalid');
    case 'CONTRACT_NOT_ACTIVE':
      return t('adm.roles.error.contractNotActive');
    case 'SYSTEM_ROLE_IMMUTABLE':
      return t('adm.roles.error.systemRoleImmutable');
    case 'LAST_TENANT_OWNER':
      return t('adm.roles.error.lastTenantOwner');
    case 'SELF_ACTION_DENIED':
      return t('adm.roles.error.selfActionDenied');
    case 'VERSION_CONFLICT':
      return t('adm.roles.error.versionConflict');
    case 'ROLE_GRANT_EXISTS':
      return t('adm.roles.error.grantExists');
    case 'ROLE_CODE_TAKEN':
      return t('adm.roles.error.roleCodeTaken');
    case 'SCOPE_DENIED':
      return t('adm.roles.error.scopeDenied');
    case 'RESOURCE_NOT_FOUND':
      return t('adm.roles.error.notFound');
    case 'VALIDATION_FAILED':
    case 'INVALID_REQUEST':
    case 'FIELD_NOT_ALLOWED':
      return t('adm.roles.error.invalid');
    case NETWORK_ERROR_CODE:
      return t('adm.roles.error.network');
    default:
      return t('adm.roles.error.generic');
  }
}

/** The request field a problem names in its `detail` (for example `reason`), so the field can be marked invalid. */
export function offendingField(error: unknown): string | undefined {
  return error instanceof ApiError ? error.detail : undefined;
}
