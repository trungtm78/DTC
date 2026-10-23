import type { Translator } from '../../../i18n';
import type { CheckId, CheckState } from './checks';
import type { ProblemView } from './problems';
import type { ChainStatus, Overall, Profile, Regime, RevocationStatus, Role } from './types';

type T = Translator['t'];

// Every key is written out so the i18n check can see it is in use.
export function checkTitle(t: T, id: CheckId): string {
  switch (id) {
    case 'order':
      return t('doc.signatureReport.check.order.title');
    case 'chain':
      return t('doc.signatureReport.check.chain.title');
    case 'revocation':
      return t('doc.signatureReport.check.revocation.title');
    case 'incremental':
      return t('doc.signatureReport.check.incremental.title');
    case 'timestamp':
      return t('doc.signatureReport.check.timestamp.title');
    case 'conclusion':
      return t('doc.signatureReport.check.conclusion.title');
  }
}

export function checkHint(t: T, id: CheckId): string {
  switch (id) {
    case 'order':
      return t('doc.signatureReport.check.order.hint');
    case 'chain':
      return t('doc.signatureReport.check.chain.hint');
    case 'revocation':
      return t('doc.signatureReport.check.revocation.hint');
    case 'incremental':
      return t('doc.signatureReport.check.incremental.hint');
    case 'timestamp':
      return t('doc.signatureReport.check.timestamp.hint');
    case 'conclusion':
      return t('doc.signatureReport.check.conclusion.hint');
  }
}

export function stateLabel(t: T, state: CheckState): string {
  switch (state) {
    case 'pass':
      return t('doc.signatureReport.state.pass');
    case 'review':
      return t('doc.signatureReport.state.review');
    case 'fail':
      return t('doc.signatureReport.state.fail');
    case 'none':
      return t('doc.signatureReport.state.none');
  }
}

export function overallLabel(t: T, overall: Overall): string {
  switch (overall) {
    case 'VALID':
      return t('doc.signatureReport.overall.valid');
    case 'INVALID':
      return t('doc.signatureReport.overall.invalid');
    case 'INDETERMINATE':
      return t('doc.signatureReport.overall.indeterminate');
  }
}

export function roleLabel(t: T, role: Role): string {
  switch (role) {
    case 'LEADER':
      return t('doc.signatureReport.role.leader');
    case 'ORGANIZATION':
      return t('doc.signatureReport.role.organization');
    case 'EXTERNAL':
      return t('doc.signatureReport.role.external');
    case 'DOCUMENT_TIMESTAMP':
      return t('doc.signatureReport.role.documentTimestamp');
  }
}

export function chainLabel(t: T, status: ChainStatus): string {
  switch (status) {
    case 'TRUSTED':
      return t('doc.signatureReport.chain.trusted');
    case 'UNTRUSTED':
      return t('doc.signatureReport.chain.untrusted');
    case 'INCOMPLETE':
      return t('doc.signatureReport.chain.incomplete');
    case 'NOT_CHECKED':
      return t('doc.signatureReport.chain.notChecked');
  }
}

export function revocationLabel(t: T, status: RevocationStatus): string {
  switch (status) {
    case 'GOOD':
      return t('doc.signatureReport.revocation.good');
    case 'REVOKED':
      return t('doc.signatureReport.revocation.revoked');
    case 'UNKNOWN':
      return t('doc.signatureReport.revocation.unknown');
    case 'NOT_CHECKED':
      return t('doc.signatureReport.revocation.notChecked');
  }
}

export function regimeLabel(t: T, regime: Regime): string {
  return regime === 'PUBLIC_CA' ? t('doc.signatureReport.regime.publicCa') : t('doc.signatureReport.regime.govSpecialized');
}

export function profileLabel(t: T, profile: Profile): string {
  switch (profile) {
    case 'PADES_B_B':
      return t('doc.signatureReport.profile.bb');
    case 'PADES_B_T':
      return t('doc.signatureReport.profile.bt');
    case 'PADES_B_LT':
      return t('doc.signatureReport.profile.blt');
    case 'PADES_B_LTA':
      return t('doc.signatureReport.profile.blta');
  }
}

/** The reason a finding code stands for; a code the screen does not know is shown as the code itself. */
export function findingLabel(t: T, code: string): string {
  switch (code) {
    case 'BYTE_RANGE_INVALID':
      return t('doc.signatureReport.finding.byteRangeInvalid');
    case 'SIGNATURE_MALFORMED':
      return t('doc.signatureReport.finding.signatureMalformed');
    case 'DIGEST_MISMATCH':
      return t('doc.signatureReport.finding.digestMismatch');
    case 'SIGNATURE_INVALID':
      return t('doc.signatureReport.finding.signatureInvalid');
    case 'ALGORITHM_NOT_ALLOWED':
      return t('doc.signatureReport.finding.algorithmNotAllowed');
    case 'SIGNER_CERTIFICATE_MISMATCH':
      return t('doc.signatureReport.finding.signerCertificateMismatch');
    case 'CHAIN_UNTRUSTED':
      return t('doc.signatureReport.finding.chainUntrusted');
    case 'CHAIN_INCOMPLETE':
      return t('doc.signatureReport.finding.chainIncomplete');
    case 'CERTIFICATE_EXPIRED_AT_SIGNING':
      return t('doc.signatureReport.finding.certificateExpired');
    case 'CERTIFICATE_REVOKED':
      return t('doc.signatureReport.finding.certificateRevoked');
    case 'REVOCATION_UNKNOWN':
      return t('doc.signatureReport.finding.revocationUnknown');
    case 'INCREMENTAL_CHANGES_NOT_ALLOWED':
      return t('doc.signatureReport.finding.incrementalChanges');
    case 'SIGNING_TIME_UNPROVEN':
      return t('doc.signatureReport.finding.signingTimeUnproven');
    case 'TIMESTAMP_INVALID':
      return t('doc.signatureReport.finding.timestampInvalid');
    case 'SIGNING_ORDER_INVALID':
      return t('doc.signatureReport.finding.signingOrderInvalid');
    default:
      return code;
  }
}

export function problemMessage(t: T, problem: ProblemView): string {
  switch (problem.reason) {
    case 'notPdf':
      return t('doc.signatureReport.problem.notPdf.text');
    case 'scanPending':
      return t('doc.signatureReport.problem.scanPending.text');
    case 'invalid':
      return t('doc.signatureReport.problem.invalid.text');
    case 'notFound':
      return t('doc.signatureReport.problem.notFound.text');
    case 'denied':
      return t('doc.signatureReport.problem.denied.text');
    case 'session':
      return t('doc.signatureReport.problem.session.text');
    case 'general':
      return t('doc.signatureReport.problem.general.text');
  }
}
