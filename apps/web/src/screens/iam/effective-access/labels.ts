import type { Translator } from '../../../i18n';
import type { GrantState, ScopeKind } from './types';

type T = Translator['t'];

/** The label of where a grant stands; each key is written out so the i18n check can see it is in use. */
export function stateLabel(t: T, state: GrantState): string {
  switch (state) {
    case 'ACTIVE':
      return t('iam.effectiveAccess.state.active');
    case 'EXPIRED':
      return t('iam.effectiveAccess.state.expired');
    case 'FUTURE':
      return t('iam.effectiveAccess.state.future');
  }
}

/** The pill class of a state in the prototype's colours. */
export const statePill = (state: GrantState): string => (state === 'ACTIVE' ? 'pill' : state === 'FUTURE' ? 'pill warn' : 'pill gray');

/** The role as a person reads it: its code, and its name when the role is a custom one (a system role's name is a catalogue key). */
export function customRoleName(code: string, name: string): string | undefined {
  return name === '' || name === code || name.startsWith('iam.role.') ? undefined : name;
}

/** The label of a scope kind. */
export function scopeLabel(t: T, kind: ScopeKind): string {
  switch (kind) {
    case 'TENANT':
      return t('iam.effectiveAccess.scope.tenant');
    case 'UNIT_SUBTREE':
      return t('iam.effectiveAccess.scope.unitSubtree');
    case 'UNIT_ONLY':
      return t('iam.effectiveAccess.scope.unitOnly');
    case 'PROJECT':
      return t('iam.effectiveAccess.scope.project');
    case 'CONTRACT':
      return t('iam.effectiveAccess.scope.contract');
  }
}

/** The calendar day of an ISO timestamp (the screen shows days, not instants). */
export const dayOf = (timestamp: string): string => timestamp.slice(0, 10);

/** A validity window as one line: the first day, then the last or the open-ended wording. */
export function windowLabel(t: T, from: string, until: string | null): string {
  return t('iam.effectiveAccess.window.text', { from: dayOf(from), until: until === null ? t('iam.effectiveAccess.window.open') : dayOf(until) });
}
