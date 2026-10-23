import type { ThemeConfig } from '@machvon/db';

/** The longest name, title or header a theme may carry (TenantThemeConfig in openapi.json); a tenant name may be longer (255). */
export const THEME_DISPLAY_MAX = 160;

/** The tenant name cut to what the theme contract allows, by characters (not UTF-16 units), without a trailing space. */
export function themeDisplayName(tenantName: string): string {
  const characters = Array.from(tenantName.trim());
  return characters.length <= THEME_DISPLAY_MAX ? characters.join('') : characters.slice(0, THEME_DISPLAY_MAX).join('').trimEnd();
}

/**
 * Version 1 of the theme of every new tenant (SAS 3.1 step 10): the colours and texts of the prototype under the name of the
 * tenant. The text fields are the defaults a System Admin replaces in SAS-04; the colours pass the contrast rules of the design tokens.
 */
export function defaultTenantTheme(tenantName: string): ThemeConfig {
  const display = themeDisplayName(tenantName);
  return {
    name: display,
    title: display,
    subtitle: '',
    header: display,
    footer: '',
    address: '',
    email: '',
    phone: '',
    primary: '#b4233d',
    primaryText: '#ffffff',
    menu: '#ffffff',
    menuText: '#615b66',
    selected: '#fff0f2',
    selectedText: '#a11d37',
    headerBg: '#ffffff',
    headerText: '#514a56',
    footerBg: '#ffffff',
    footerText: '#68616c',
    background: '#f7f5f4',
    titleColor: '#29272d',
    logoAssetId: null,
  };
}
