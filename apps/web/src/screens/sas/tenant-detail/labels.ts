import type { Translator } from '../../../i18n';
import type { AccessPolicy, SuspensionReasonCode } from './rules';

type Translate = Translator['t'];

/** The label of a suspension reason code; each key is written out so the i18n check can see it is in use. */
export function reasonCodeLabel(t: Translate, code: SuspensionReasonCode): string {
  switch (code) {
    case 'NON_PAYMENT':
      return t('sas.tenantDetail.reasonCode.nonPayment');
    case 'SECURITY_INCIDENT':
      return t('sas.tenantDetail.reasonCode.securityIncident');
    case 'CUSTOMER_REQUEST':
      return t('sas.tenantDetail.reasonCode.customerRequest');
    case 'LICENSE_REVOKED':
      return t('sas.tenantDetail.reasonCode.licenseRevoked');
    case 'LEGAL_ORDER':
      return t('sas.tenantDetail.reasonCode.legalOrder');
  }
}

export function policyLabel(t: Translate, policy: AccessPolicy): string {
  return policy === 'NO_ACCESS' ? t('sas.tenantDetail.policy.noAccess') : t('sas.tenantDetail.policy.readOnlyExport');
}
