import { LOGO_ASSET_KEY, THEME_COLOR_KEYS, TOKENS, validateTenantOverlay } from '@machvon/design-tokens';
import { DomainError } from '@machvon/kernel';
import type { Schemas } from '../../contract-types';

export type TenantThemeConfig = Schemas['TenantThemeConfig'];

// The syntax check the contract asks for ("empty allowed; otherwise validate email syntax server-side"): one at sign, a dotted host, no spaces.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Judges a theme as a whole before it is stored or published: the twelve colours and the logo through the one entry
 * of the design tokens (hex only, six contrast pairs of at least 4.5:1, nothing that could become CSS), the contact
 * email by syntax. A broken theme is 422 VALIDATION_FAILED with the findings (code, token, pair, ratio); a finding
 * never carries a value of the request.
 */
export function assertValidTheme(config: TenantThemeConfig): void {
  const overlay: Record<string, unknown> = {};
  for (const key of THEME_COLOR_KEYS) overlay[key] = config[key];
  if (config.logoAssetId !== null) overlay[LOGO_ASSET_KEY] = config.logoAssetId;
  const verdict = validateTenantOverlay(TOKENS, overlay);
  if (!verdict.ok) {
    throw new DomainError('VALIDATION_FAILED', 422, verdict.findings[0]?.token, { extensions: { findings: verdict.findings } });
  }
  if (config.email !== '' && !EMAIL.test(config.email)) throw new DomainError('VALIDATION_FAILED', 422, 'email');
}
