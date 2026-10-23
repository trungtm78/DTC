import type { Translator } from '../../../i18n';
import type { ProblemView } from './problems';
import type { UnitType } from './types';

type Translate = Translator['t'];

/** The message of a failed command; each key is written out so the i18n check can see it is in use. */
export function problemMessage(t: Translate, view: ProblemView): string {
  switch (view.reason) {
    case 'cycle':
      return t('adm.orgUnit.error.cycle');
    case 'depth':
      return t('adm.orgUnit.error.depth');
    case 'codeTaken':
      return t('adm.orgUnit.error.codeTaken');
    case 'validity':
      return t('adm.orgUnit.error.validity');
    case 'invalid':
      return t('adm.orgUnit.error.invalid');
    case 'fieldNotAllowed':
      return t('adm.orgUnit.error.fieldNotAllowed');
    case 'scopeDenied':
      return t('adm.orgUnit.error.scopeDenied');
    case 'notFound':
      return t('adm.orgUnit.error.notFound');
    case 'conflict':
      return t('adm.orgUnit.conflict.message', { version: view.currentVersion ?? '' });
    case 'stepUp':
      return t('adm.orgUnit.error.stepUp');
    case 'session':
      return t('adm.orgUnit.error.session');
    case 'general':
      return t('adm.orgUnit.error.general');
  }
}

/** The label of a unit status; a status this screen does not know is shown as the server wrote it. */
export function statusLabel(t: Translate, status: string): string {
  switch (status) {
    case 'Planned':
      return t('adm.orgUnit.status.planned');
    case 'Active':
      return t('adm.orgUnit.status.active');
    case 'Superseded':
      return t('adm.orgUnit.status.superseded');
    case 'Dissolved':
      return t('adm.orgUnit.status.dissolved');
    default:
      return status;
  }
}

export function unitTypeLabel(t: Translate, type: UnitType): string {
  switch (type) {
    case 'DEPARTMENT':
      return t('adm.orgUnit.unitType.department');
    case 'PROJECT_MANAGEMENT_BOARD':
      return t('adm.orgUnit.unitType.projectBoard');
    case 'INVESTOR':
      return t('adm.orgUnit.unitType.investor');
    case 'COMMUNE':
      return t('adm.orgUnit.unitType.commune');
    case 'DIVISION':
      return t('adm.orgUnit.unitType.division');
    case 'OTHER':
      return t('adm.orgUnit.unitType.other');
  }
}
