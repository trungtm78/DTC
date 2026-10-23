import { defineModule } from '../module-descriptor';
import { LegalHoldReadsController, LegalHoldsController } from './legal-holds.controller';

/** ADM, the tenant administration: legal holds (ST-ADM-003). Members and invitations join the controllers list. */
export const admModule = defineModule({
  code: 'ADM',
  controllers: [LegalHoldsController, LegalHoldReadsController],
});
