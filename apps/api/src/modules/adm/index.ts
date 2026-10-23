import { defineModule } from '../module-descriptor';
import { AuditEventsController } from './audit-events.controller';
import { SigningCertificateReadsController, SigningCertificatesController } from './certificates.controller';
import { ContractPickerController } from './contract-picker.controller';
import { GuestContractorController } from './guest-contractor.controller';
import { INVITATION_MAILER, MockInvitationMailer } from './invitation-mailer';
import { LegalHoldReadsController, LegalHoldsController } from './legal-holds.controller';
import { MembersController } from './members.controller';
import { SecurityPoliciesController, SecurityPolicyReadsController } from './security-policy.controller';

/**
 * ADM, the tenant administration: the audit trail (ST-ADM-002), legal holds (ST-ADM-003), members and invitations
 * (ST-ADM-006), guest contractors (ST-ADM-007), signing certificates (ST-ADM-008) and security policy versions (ST-ADM-009).
 */
export const admModule = defineModule({
  code: 'ADM',
  controllers: [
    AuditEventsController,
    LegalHoldsController,
    LegalHoldReadsController,
    MembersController,
    GuestContractorController,
    ContractPickerController,
    SigningCertificatesController,
    SigningCertificateReadsController,
    SecurityPoliciesController,
    SecurityPolicyReadsController,
  ],
  // The email channel belongs to OMNI (R1); until then invitations are kept in memory by the MOCK adapter.
  providers: [{ provide: INVITATION_MAILER, useValue: new MockInvitationMailer() }],
});
