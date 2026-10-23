import { ApiError, NETWORK_ERROR_CODE } from '@machvon/api-client';
import type { Translator } from '../../../i18n';
import { issuesOfProblem } from './rules';
import type { ThemeIssue } from './rules';

type Translate = Translator['t'];

/** The label of a theme field: the eight texts, the logo and the twelve colours. A key the screen does not know is shown as it is. */
export function fieldLabel(t: Translate, key: string): string {
  switch (key) {
    case 'name':
      return t('sas.theme.field.name.label');
    case 'title':
      return t('sas.theme.field.title.label');
    case 'subtitle':
      return t('sas.theme.field.subtitle.label');
    case 'header':
      return t('sas.theme.field.header.label');
    case 'footer':
      return t('sas.theme.field.footer.label');
    case 'address':
      return t('sas.theme.field.address.label');
    case 'email':
      return t('sas.theme.field.email.label');
    case 'phone':
      return t('sas.theme.field.phone.label');
    case 'logoAssetId':
      return t('sas.theme.field.logo.label');
    case 'primary':
      return t('sas.theme.field.primary.label');
    case 'primaryText':
      return t('sas.theme.field.primaryText.label');
    case 'menu':
      return t('sas.theme.field.menu.label');
    case 'menuText':
      return t('sas.theme.field.menuText.label');
    case 'selected':
      return t('sas.theme.field.selected.label');
    case 'selectedText':
      return t('sas.theme.field.selectedText.label');
    case 'headerBg':
      return t('sas.theme.field.headerBg.label');
    case 'headerText':
      return t('sas.theme.field.headerText.label');
    case 'footerBg':
      return t('sas.theme.field.footerBg.label');
    case 'footerText':
      return t('sas.theme.field.footerText.label');
    case 'background':
      return t('sas.theme.field.background.label');
    case 'titleColor':
      return t('sas.theme.field.titleColor.label');
    default:
      return key;
  }
}

/** The sentence for one reason a theme cannot be saved or published; it names the fields and the ratio, never a value. */
export function issueMessage(t: Translate, issue: ThemeIssue): string {
  const field = fieldLabel(t, issue.token ?? '');
  switch (issue.kind) {
    case 'CONTRAST':
      return t('sas.theme.issue.contrast.text', { foreground: field, background: fieldLabel(t, issue.against ?? ''), ratio: issue.ratio === undefined ? '' : issue.ratio.toFixed(2) });
    case 'FORBIDDEN_VALUE':
      return t('sas.theme.issue.forbidden.text', { field });
    case 'BAD_COLOR':
      return t('sas.theme.issue.badColor.text', { field });
    case 'UNKNOWN_TOKEN':
      return t('sas.theme.issue.unknown.text', { field });
    case 'LOGO':
      return t('sas.theme.issue.logo.text');
    case 'REQUIRED':
      return t('sas.theme.issue.required.text', { field });
    case 'EMAIL':
      return t('sas.theme.issue.email.text');
  }
}

/** What went wrong with a call of this screen, in the words of the screen. */
export type ProblemKind =
  | 'conflict'
  | 'reviewInvalid'
  | 'invalid'
  | 'fileType'
  | 'tooLarge'
  | 'infected'
  | 'notFound'
  | 'denied'
  | 'stepUp'
  | 'session'
  | 'offline'
  | 'general';

export interface ProblemView {
  kind: ProblemKind;
  /** The findings of a refused theme, to show one by one. */
  issues: ThemeIssue[];
  currentVersion: number | undefined;
}

const KIND_BY_CODE: Readonly<Record<string, ProblemKind>> = {
  VERSION_CONFLICT: 'conflict',
  REVIEW_INVALID: 'reviewInvalid',
  VALIDATION_FAILED: 'invalid',
  INVALID_REQUEST: 'invalid',
  FIELD_NOT_ALLOWED: 'invalid',
  FILE_TYPE_NOT_ALLOWED: 'fileType',
  PAYLOAD_TOO_LARGE: 'tooLarge',
  FILE_NOT_CLEAN: 'infected',
  RESOURCE_NOT_FOUND: 'notFound',
  SCOPE_DENIED: 'denied',
  MFA_REQUIRED: 'stepUp',
  SESSION_EXPIRED: 'session',
  [NETWORK_ERROR_CODE]: 'offline',
};

export function describeProblem(error: unknown): ProblemView {
  if (!(error instanceof ApiError)) return { kind: 'general', issues: [], currentVersion: undefined };
  const current = error.extensions.current_version;
  return { kind: KIND_BY_CODE[error.code] ?? 'general', issues: issuesOfProblem(error.extensions), currentVersion: typeof current === 'number' ? current : undefined };
}

export function problemMessage(t: Translate, kind: ProblemKind): string {
  switch (kind) {
    case 'conflict':
      return t('sas.theme.error.conflict.text');
    case 'reviewInvalid':
      return t('sas.theme.error.reviewInvalid.text');
    case 'invalid':
      return t('sas.theme.error.invalid.text');
    case 'fileType':
      return t('sas.theme.error.fileType.text');
    case 'tooLarge':
      return t('sas.theme.error.tooLarge.text');
    case 'infected':
      return t('sas.theme.error.infected.text');
    case 'notFound':
      return t('sas.theme.error.notFound.text');
    case 'denied':
      return t('sas.theme.error.denied.text');
    case 'stepUp':
      return t('sas.theme.error.stepUp.text');
    case 'session':
      return t('sas.theme.error.session.text');
    case 'offline':
      return t('sas.theme.error.offline.text');
    case 'general':
      return t('sas.theme.error.general.text');
  }
}
