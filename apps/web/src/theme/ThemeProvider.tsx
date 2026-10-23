import { THEME_COLOR_KEYS, TENANT_THEME_SELECTOR, kebabCase, validateTenantOverlay } from '@machvon/design-tokens';
import type { ThemeColorKey, Tokens } from '@machvon/design-tokens';
import { createContext, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '../i18n';

/** A published tenant theme: its identity and the colour overlay SAS-04 validated when it was reviewed. */
export interface TenantThemeSpec {
  themeId: string;
  version: number;
  overlay: unknown;
}

/** What a tenant without a published theme shows: the base Ruby / Porcelain tokens. */
export const BASE_THEME: TenantThemeSpec = { themeId: 'base', version: 1, overlay: {} };

export interface ThemeState {
  themeId: string;
  themeVersion: number;
  /** The last overlay offered was rejected and the previous theme is still shown. */
  rejected: boolean;
}

const ThemeContext = createContext<ThemeState>({ themeId: BASE_THEME.themeId, themeVersion: BASE_THEME.version, rejected: false });

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

interface Applied {
  themeId: string;
  themeVersion: number;
  css: string | null;
  /** The colours the overlay sets; the stylesheet maps only these, so every other colour stays the prototype's own. */
  keys: readonly ThemeColorKey[];
}

/** The custom properties of the colours the overlay sets (validated and normalised), scoped to the theme wrapper. */
function explicitDeclarations(overlay: unknown, tokens: Tokens): { keys: ThemeColorKey[]; css: string | null } {
  const names = typeof overlay === 'object' && overlay !== null ? Object.keys(overlay) : [];
  const keys = THEME_COLOR_KEYS.filter((key) => names.includes(key));
  if (keys.length === 0) return { keys, css: null };
  const lines = keys.map((key) => `  --mv-theme-${kebabCase(key)}: ${tokens.tenantTheme[key]};`);
  return { keys, css: [`${TENANT_THEME_SELECTOR} {`, ...lines, '}', ''].join('\n') };
}

export interface ThemeProviderProps {
  base: Tokens;
  theme: TenantThemeSpec;
  children: ReactNode;
}

/**
 * Applies a validated tenant overlay to everything inside it. The overlay is accepted whole or not at all: a rejected
 * one (contrast, forbidden value, unknown token) leaves the previous theme in place and shows a notice. The children
 * always sit in the same position of the tree, so a theme change never remounts a screen or loses an open form.
 */
export function ThemeProvider({ base, theme, children }: ThemeProviderProps) {
  const { t } = useTranslation();
  const lastApplied = useRef<Applied>({ themeId: BASE_THEME.themeId, themeVersion: BASE_THEME.version, css: null, keys: [] });
  const { applied, rejected } = useMemo(() => {
    const result = validateTenantOverlay(base, theme.overlay);
    if (result.ok) {
      lastApplied.current = { themeId: theme.themeId, themeVersion: theme.version, ...explicitDeclarations(theme.overlay, result.tokens) };
      return { applied: lastApplied.current, rejected: false };
    }
    return { applied: lastApplied.current, rejected: true };
  }, [base, theme]);
  const state = useMemo<ThemeState>(
    () => ({ themeId: applied.themeId, themeVersion: applied.themeVersion, rejected }),
    [applied, rejected],
  );

  return (
    <ThemeContext.Provider value={state}>
      <div data-mv-tenant-theme="" data-mv-theme-id={applied.themeId} data-mv-theme-version={applied.themeVersion} data-mv-theme-keys={applied.keys.join(' ')}>
        {applied.css === null ? null : <style>{applied.css}</style>}
        {rejected ? (
          <p role="status" className="callout warning">
            {t('theme.overlay.rejected')}
          </p>
        ) : null}
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
