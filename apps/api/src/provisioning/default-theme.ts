import type { ThemeConfig } from '@machvon/db';

/**
 * Version 1 of the theme of every new tenant (SAS 3.1 step 10): the colours and texts of the prototype under the name of the
 * tenant. The text fields are the defaults a System Admin replaces in SAS-04; the colours pass the contrast rules of the design tokens.
 */
export function defaultTenantTheme(tenantName: string): ThemeConfig {
  return {
    name: tenantName,
    title: tenantName,
    subtitle: '',
    header: tenantName,
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
