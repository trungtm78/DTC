import * as api from '../src/index.ts';
import { realDesignTokens } from './support.ts';

describe('package entry', () => {
  it('exports the committed tokens, equal to a fresh build of the design token file', () => {
    expect(api.TOKENS).toEqual(api.buildTokens(realDesignTokens()));
  });

  it('exports the public functions and rules', () => {
    expect(api.DESIGN_TOKENS_PACKAGE).toBe('@machvon/design-tokens');
    expect(typeof api.contrastRatio).toBe('function');
    expect(typeof api.validateTenantOverlay).toBe('function');
    expect(typeof api.generateTokens).toBe('function');
    expect(api.THEME_COLOR_KEYS).toHaveLength(12);
    expect(api.CONTRAST_PAIRS).toHaveLength(6);
    expect(api.MIN_TEXT_CONTRAST).toBe(4.5);
  });

  it('validates an overlay against the exported base tokens', () => {
    expect(api.validateTenantOverlay(api.TOKENS, { primary: '#244C78' }).ok).toBe(true);
    expect(api.validateTenantOverlay(api.TOKENS, { primary: 'red' }).ok).toBe(false);
  });
});
