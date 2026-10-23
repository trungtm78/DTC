import { defineModule } from '../module-descriptor';
import { EffectiveAccessController } from './effective-access.controller';

/** IAM, access and the person: what the caller may do and where (IAM-09). Tenant selection and the membership reads still live in src/session. */
export const iamModule = defineModule({
  code: 'IAM',
  controllers: [EffectiveAccessController],
});
