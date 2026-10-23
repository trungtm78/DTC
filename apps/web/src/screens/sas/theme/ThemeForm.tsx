import { THEME_COLOR_KEYS } from '@machvon/design-tokens';
import type { ThemeColorKey } from '@machvon/design-tokens';
import type { ChangeEvent, ReactNode } from 'react';
import { useTranslation } from '../../../i18n';
import { fieldLabel, issueMessage } from './labels';
import { PRESET_IDS } from './rules';
import type { PresetId, ThemeIssue } from './rules';
import { LOGO_TYPES, MAX_LENGTH, TEXT_FIELDS } from './types';
import type { TextField, ThemeConfig } from './types';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const NO_COLOUR = '#000000';

export interface ThemeFormProps {
  config: ThemeConfig;
  /** Nobody may change the theme (a reader of the published theme, a suspended session): every field is disabled and no control is offered. */
  readOnly: boolean;
  issues: readonly ThemeIssue[];
  /** The name of the file uploaded in this session; the logo of the theme otherwise only exists as an asset. */
  logoName: string | undefined;
  logoPending: boolean;
  /** A sentence about the last logo that was refused or failed. */
  logoProblem: string | undefined;
  onText(field: TextField, value: string): void;
  onColour(key: ThemeColorKey, value: string): void;
  onPreset(preset: PresetId): void;
  onLogo(file: File): void;
  onRemoveLogo(): void;
  /** The buttons under the validation line (save, discard, review). */
  actions: ReactNode;
}

function presetLabel(t: ReturnType<typeof useTranslation>['t'], preset: PresetId): string {
  switch (preset) {
    case 'ruby':
      return t('sas.theme.preset.ruby.label');
    case 'navy':
      return t('sas.theme.preset.navy.label');
    case 'emerald':
      return t('sas.theme.preset.emerald.label');
  }
}

/** The identity and the colours of a theme as the SAS-04 form of the mockup lays them out. */
export function ThemeForm(props: ThemeFormProps) {
  const { t } = useTranslation();
  const { config, readOnly, issues } = props;

  const pickLogo = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file !== undefined) props.onLogo(file);
  };

  return (
    <fieldset disabled={readOnly} className="theme-fields">
      <h2>{t('sas.theme.identity.title')}</h2>
      {TEXT_FIELDS.map((field) => (
        <div key={field}>
          <label htmlFor={`theme-${field}`}>{fieldLabel(t, field)}</label>
          <input id={`theme-${field}`} value={config[field]} maxLength={MAX_LENGTH[field]} onChange={(event) => props.onText(field, event.target.value)} />
        </div>
      ))}
      <label htmlFor="theme-logo">{t('sas.theme.field.logo.label')}</label>
      <input id="theme-logo" type="file" accept={LOGO_TYPES.join(',')} disabled={readOnly || props.logoPending} onChange={pickLogo} />
      <p className="theme-logo-info" id="theme-logo-name">
        {props.logoName ?? (config.logoAssetId === null ? t('sas.theme.logo.none.text') : t('sas.theme.logo.some.text'))}
      </p>
      {props.logoProblem === undefined ? null : (
        <p className="field-error" role="alert">
          {props.logoProblem}
        </p>
      )}
      <button type="button" disabled={readOnly || config.logoAssetId === null} onClick={props.onRemoveLogo}>
        {t('sas.theme.logo.remove.action')}
      </button>
      <p className="theme-help">{t('sas.theme.logo.help.text')}</p>

      <h2>{t('sas.theme.palette.title')}</h2>
      <div className="theme-presets">
        {PRESET_IDS.map((preset) => (
          <button key={preset} type="button" onClick={() => props.onPreset(preset)}>
            {presetLabel(t, preset)}
          </button>
        ))}
      </div>
      <div className="theme-colors">
        {THEME_COLOR_KEYS.map((key) => (
          <div key={key}>
            <label htmlFor={`theme-${key}`}>{fieldLabel(t, key)}</label>
            <input type="color" id={`theme-${key}`} value={HEX_COLOR.test(config[key]) ? config[key] : NO_COLOUR} onChange={(event) => props.onColour(key, event.target.value)} />
          </div>
        ))}
      </div>

      <div id="theme-validation" className={`theme-validation${issues.length === 0 ? '' : ' invalid'}`} role="status" data-issues={issues.length}>
        {issues.length === 0 ? (
          <>
            <b>{t('sas.theme.validation.valid.title')}</b>
            <p>{t('sas.theme.validation.valid.text')}</p>
          </>
        ) : (
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.kind}-${issue.token ?? ''}-${index}`} data-issue={issue.kind}>
                {issueMessage(t, issue)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {props.actions}
    </fieldset>
  );
}
