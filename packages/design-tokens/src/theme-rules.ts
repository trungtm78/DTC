/**
 * The tenant theme rules of `Tenant_Theme_Specification.html` (SAS-04) and the prototype `tenant-theme.js` it
 * describes: twelve overridable colours, six text on background pairs of at least 4.5:1, colours as hex only.
 * `test/spec.test.ts` keeps these constants equal to the design package.
 */
export const THEME_COLOR_KEYS = [
  'primary',
  'primaryText',
  'menu',
  'menuText',
  'selected',
  'selectedText',
  'headerBg',
  'headerText',
  'footerBg',
  'footerText',
  'background',
  'titleColor',
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

/** Minimum contrast of every text/background pair (WCAG AA for normal text). */
export const MIN_TEXT_CONTRAST = 4.5;

export interface ContrastPair {
  id: string;
  foreground: ThemeColorKey;
  background: ThemeColorKey;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { id: 'primaryButton', foreground: 'primaryText', background: 'primary' },
  { id: 'menu', foreground: 'menuText', background: 'menu' },
  { id: 'selectedItem', foreground: 'selectedText', background: 'selected' },
  { id: 'header', foreground: 'headerText', background: 'headerBg' },
  { id: 'footer', foreground: 'footerText', background: 'footerBg' },
  { id: 'title', foreground: 'titleColor', background: 'background' },
];

/** The only overlay key that is not a colour: an id of a stored asset, never a URL or a file name. */
export const LOGO_ASSET_KEY = 'logoAssetId';
