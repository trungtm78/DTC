import type { ThemeColorKey } from './theme-rules.ts';

/** The shape of `04_Design_Assets/design_tokens.json` (Ruby / Porcelain). */
export interface DesignTokens {
  name: string;
  version: string;
  color: Record<string, string>;
  font: {
    family: string;
    body: number;
    title: number;
    mobileBody: number;
    navPrimary: number;
    navSecondary: number;
  };
  space: number[];
  radius: Record<string, number>;
  viewport: { web: [number, number]; mobile: [number, number] };
  touch: { ios_pt: number; android_dp: number };
  displayName: string;
  prototypeNavigation: Record<string, unknown>;
  businessNavigation: {
    sidebarWidth: number;
    compactSidebarWidth: number;
    mobileDrawerBreakpoint: number;
    inboxSinglePaneBreakpoint: number;
    selectedText: string;
    [key: string]: unknown;
  };
  theme: string;
}

export type ThemeColors = Record<ThemeColorKey, string>;

/** The design tokens plus the twelve colours a tenant may override (the base values come from the design tokens). */
export type Tokens = DesignTokens & {
  tenantTheme: ThemeColors;
  /** Reference to a stored logo asset; never a URL. */
  logoAssetId?: string;
};
