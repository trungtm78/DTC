import { defineModule } from '../module-descriptor';
import { AuditEventsController } from './audit-events.controller';
import { GuestContractorController } from './guest-contractor.controller';
import { INVITATION_MAILER, MockInvitationMailer } from './invitation-mailer';
import { LegalHoldReadsController, LegalHoldsController } from './legal-holds.controller';
import { MembersController } from './members.controller';

/** ADM, the tenant administration: the audit trail (ST-ADM-002), legal holds (ST-ADM-003), members and invitations (ST-ADM-006) and guest contractors (ST-ADM-007). */
export const admModule = defineModule({
  code: 'ADM',
  controllers: [AuditEventsController, LegalHoldsController, LegalHoldReadsController, MembersController, GuestContractorController],
  // The email channel belongs to OMNI (R1); until then invitations are kept in memory by the MOCK adapter.
  providers: [{ provide: INVITATION_MAILER, useValue: new MockInvitationMailer() }],
});
