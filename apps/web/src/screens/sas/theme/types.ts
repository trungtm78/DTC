import type { components } from '@machvon/contracts';

export type ThemeConfig = components['schemas']['TenantThemeConfig'];
export type ThemeVersion = components['schemas']['TenantThemeVersion'];
export type ThemeDraft = components['schemas']['TenantThemeDraft'];
export type ThemeReview = components['schemas']['TenantThemeReview'];

/** The one permission that edits a tenant theme: `system.theme.manage` of the control plane; everyone else reads the published theme. */
export const MANAGE_THEME_PERMISSION = 'system.theme.manage';

/** The texts of a theme, in the order of the form. */
export const TEXT_FIELDS = ['name', 'title', 'subtitle', 'header', 'footer', 'address', 'email', 'phone'] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/** `maxLength` of the contract per text. */
export const MAX_LENGTH: Readonly<Record<TextField, number>> = { name: 160, title: 160, subtitle: 160, header: 160, footer: 300, address: 300, email: 160, phone: 160 };

/** The texts that may not be empty (`minLength: 1` in the contract). */
export const REQUIRED_TEXT: readonly TextField[] = ['name', 'title', 'header'];

export const LOGO_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
/** A logo is at most 1 MiB (AC-ST-SAS-005-4); the server checks it again by the bytes. */
export const LOGO_MAX_BYTES = 1024 * 1024;

/** How many versions the history asks for at a time. */
export const VERSIONS_PAGE_SIZE = 20;
