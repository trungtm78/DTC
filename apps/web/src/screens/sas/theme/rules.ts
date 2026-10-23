import { THEME_COLOR_KEYS, TOKENS, validateTenantOverlay } from '@machvon/design-tokens';
import type { ThemeColorKey } from '@machvon/design-tokens';
import { MAX_LENGTH, REQUIRED_TEXT, TEXT_FIELDS } from './types';
import type { TextField, ThemeConfig } from './types';

/** A reason a theme cannot be saved or published, in the codes of the design tokens plus the two this form adds. */
export interface ThemeIssue {
  kind: 'CONTRAST' | 'FORBIDDEN_VALUE' | 'BAD_COLOR' | 'UNKNOWN_TOKEN' | 'LOGO' | 'REQUIRED' | 'EMAIL';
  token?: string;
  /** The background of a failing text and background pair. */
  against?: string;
  ratio?: number;
}

// The same check the server makes (apps/api theme-validation): one at sign, a dotted host, no spaces.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const FINDING_KINDS: readonly string[] = ['CONTRAST', 'FORBIDDEN_VALUE', 'BAD_COLOR', 'UNKNOWN_TOKEN', 'LOGO'];

/**
 * Everything wrong with a theme, found in the browser with the code the server runs (`validateTenantOverlay` of the design
 * tokens): contrast of the six pairs, forbidden values, colours that are not hex, a logo that is not an asset id, then the
 * texts that may not be empty and the contact email. The server judges again; this only spares the round trip.
 */
export function themeIssues(config: ThemeConfig): ThemeIssue[] {
  const overlay: Record<string, unknown> = {};
  for (const key of THEME_COLOR_KEYS) overlay[key] = config[key];
  if (config.logoAssetId !== null) overlay.logoAssetId = config.logoAssetId;
  const verdict = validateTenantOverlay(TOKENS, overlay);
  const issues: ThemeIssue[] = verdict.ok ? [] : verdict.findings.map((finding) => ({ kind: finding.code, ...(finding.token === undefined ? {} : { token: finding.token }), ...(finding.against === undefined ? {} : { against: finding.against }), ...(finding.ratio === undefined ? {} : { ratio: finding.ratio }) }));
  for (const field of REQUIRED_TEXT) if (config[field].trim() === '') issues.push({ kind: 'REQUIRED', token: field });
  if (config.email !== '' && !EMAIL.test(config.email)) issues.push({ kind: 'EMAIL', token: 'email' });
  return issues;
}

/** The findings a 422 answer carries (`findings` of the problem), as issues; anything it does not understand is dropped. */
export function issuesOfProblem(extensions: Readonly<Record<string, unknown>>): ThemeIssue[] {
  const found = extensions.findings;
  if (!Array.isArray(found)) return [];
  const issues: ThemeIssue[] = [];
  for (const item of found as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { code, token, against, ratio } = item as Record<string, unknown>;
    if (typeof code !== 'string' || !FINDING_KINDS.includes(code)) continue;
    issues.push({
      kind: code as ThemeIssue['kind'],
      ...(typeof token === 'string' ? { token } : {}),
      ...(typeof against === 'string' ? { against } : {}),
      ...(typeof ratio === 'number' ? { ratio } : {}),
    });
  }
  return issues;
}

export type PresetId = 'ruby' | 'navy' | 'emerald';
export const PRESET_IDS: readonly PresetId[] = ['ruby', 'navy', 'emerald'];

type ColourPatch = Partial<Pick<ThemeConfig, ThemeColorKey>>;

// The three palettes of the prototype (`useThemePreset`): they set the accent pair and the selected-item pair.
const PRESETS: Readonly<Record<PresetId, ColourPatch>> = {
  ruby: { primary: '#b4233d', primaryText: '#ffffff', selected: '#fff0f2', selectedText: '#a11d37' },
  navy: { primary: '#244c78', primaryText: '#ffffff', selected: '#eaf1f8', selectedText: '#244c78' },
  emerald: { primary: '#216c59', primaryText: '#ffffff', selected: '#eaf5ef', selectedText: '#216c59' },
};

export function applyPreset(config: ThemeConfig, preset: PresetId): ThemeConfig {
  return { ...config, ...PRESETS[preset] };
}

/** A text of the form is cut at the length of the contract, as the field's `maxLength` does. */
export function clampText(field: TextField, value: string): string {
  return value.slice(0, MAX_LENGTH[field]);
}

export function isTextField(key: string): key is TextField {
  return (TEXT_FIELDS as readonly string[]).includes(key);
}

export function sameTheme(left: ThemeConfig, right: ThemeConfig): boolean {
  return (Object.keys(left) as Array<keyof ThemeConfig>).every((key) => left[key] === right[key]) && Object.keys(left).length === Object.keys(right).length;
}

const COLOUR_INPUT = /^#[0-9a-f]{6}$/i;

/** A colour input only ever offers `#rrggbb`; anything else keeps the colour it had. */
export function colourOrKeep(value: string, kept: string): string {
  return COLOUR_INPUT.test(value) ? value : kept;
}
