import type { Translator } from '../../../i18n';
import type { GrantView, ScopeKind } from './types';

/** The label of a scope kind. Each key is written out so the i18n check can see it is in use. */
export function scopeLabel(t: Translator['t'], kind: ScopeKind): string {
  switch (kind) {
    case 'TENANT':
      return t('adm.roles.scope.tenant');
    case 'UNIT_SUBTREE':
      return t('adm.roles.scope.unitSubtree');
    case 'UNIT_ONLY':
      return t('adm.roles.scope.unitOnly');
    case 'PROJECT':
      return t('adm.roles.scope.project');
    case 'CONTRACT':
      return t('adm.roles.scope.contract');
  }
}

export function statusLabel(t: Translator['t'], status: GrantView['status']): string {
  switch (status) {
    case 'Active':
      return t('adm.roles.grants.status.active');
    case 'Revoked':
      return t('adm.roles.grants.status.revoked');
    case 'Expired':
      return t('adm.roles.grants.status.expired');
  }
}

/** The calendar date of an ISO timestamp (the table shows days, not instants). */
export function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** The validity of a grant as one line: `2026-01-01` followed by the open-ended wording. */
export function windowLabel(t: Translator['t'], grant: GrantView): string {
  return t('adm.roles.grants.window.text', {
    from: dayOf(grant.effective_from),
    until: grant.effective_until === null ? t('adm.roles.grants.window.open') : dayOf(grant.effective_until),
  });
}
