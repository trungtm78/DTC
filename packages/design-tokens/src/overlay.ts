import { contrastRatio, normaliseHexColor } from './contrast.ts';
import { themeDeclarations } from './generate.ts';
import { CONTRAST_PAIRS, LOGO_ASSET_KEY, MIN_TEXT_CONTRAST, THEME_COLOR_KEYS } from './theme-rules.ts';
import type { ThemeColorKey } from './theme-rules.ts';
import type { ThemeColors, Tokens } from './types.ts';

export interface Finding {
  code: 'CONTRAST' | 'FORBIDDEN_VALUE' | 'UNKNOWN_TOKEN' | 'BAD_COLOR' | 'LOGO';
  token?: string;
  /** The background token of a failing text/background pair. */
  against?: string;
  /** The measured ratio of a failing pair, rounded down to two decimals. */
  ratio?: number;
}

export type OverlayResult = { ok: true; tokens: Tokens; css: string } | { ok: false; findings: Finding[] };

export const TENANT_THEME_SELECTOR = '[data-mv-tenant-theme]';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Anything that could leave a colour value and become another CSS declaration, rule, resource or markup.
const FORBIDDEN_VALUE = /url\s*\(|expression\s*\(|@import|javascript:|[<>;{}\\]|\/\*|\*\//i;
const THEME_KEYS: ReadonlySet<string> = new Set(THEME_COLOR_KEYS);

function checkColour(token: string, value: unknown): Finding | string {
  if (typeof value !== 'string') return { code: 'BAD_COLOR', token };
  if (FORBIDDEN_VALUE.test(value)) return { code: 'FORBIDDEN_VALUE', token };
  if (!HEX_COLOR.test(value)) return { code: 'BAD_COLOR', token };
  return normaliseHexColor(value);
}

function floorTo2(value: number): number {
  return Math.floor(value * 100) / 100;
}

function contrastFindings(theme: ThemeColors, skipped: ReadonlySet<ThemeColorKey>): Finding[] {
  const findings: Finding[] = [];
  for (const pair of CONTRAST_PAIRS) {
    if (skipped.has(pair.foreground) || skipped.has(pair.background)) continue;
    const ratio = contrastRatio(theme[pair.foreground], theme[pair.background]);
    if (ratio < MIN_TEXT_CONTRAST) findings.push({ code: 'CONTRAST', token: pair.foreground, against: pair.background, ratio: floorTo2(ratio) });
  }
  return findings;
}

/**
 * Validates a tenant theme overlay against the base tokens (SAS-04): only the twelve colours and a logo asset id,
 * colours as hex only, each of the six text/background pairs at least 4.5:1 once the overlay is applied. The overlay
 * is accepted whole or rejected whole; the base tokens are never modified.
 */
export function validateTenantOverlay(base: Tokens, overlay: unknown): OverlayResult {
  if (typeof overlay !== 'object' || overlay === null || Array.isArray(overlay)) {
    return { ok: false, findings: [{ code: 'UNKNOWN_TOKEN' }] };
  }
  const findings: Finding[] = [];
  const theme: ThemeColors = { ...base.tenantTheme };
  const unusable = new Set<ThemeColorKey>();
  let logoAssetId: string | undefined;

  for (const [token, value] of Object.entries(overlay as Record<string, unknown>)) {
    if (token === LOGO_ASSET_KEY) {
      if (typeof value === 'string' && ASSET_ID.test(value)) logoAssetId = value;
      else findings.push({ code: 'LOGO', token });
    } else if (THEME_KEYS.has(token)) {
      const checked = checkColour(token, value);
      if (typeof checked === 'string') theme[token as ThemeColorKey] = checked;
      else {
        findings.push(checked);
        unusable.add(token as ThemeColorKey);
      }
    } else {
      findings.push({ code: 'UNKNOWN_TOKEN', token });
    }
  }
  findings.push(...contrastFindings(theme, unusable));
  if (findings.length > 0) return { ok: false, findings };

  const tokens: Tokens = { ...base, tenantTheme: theme };
  if (logoAssetId === undefined) delete tokens.logoAssetId;
  else tokens.logoAssetId = logoAssetId;
  const css = [`${TENANT_THEME_SELECTOR} {`, ...themeDeclarations(theme, '  '), '}', ''].join('\n');
  return { ok: true, tokens, css };
}
