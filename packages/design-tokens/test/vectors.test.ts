import { contrastRatio } from '../src/contrast.ts';
import { TOKENS } from '../src/tokens.generated.ts';
import { validateTenantOverlay } from '../src/overlay.ts';
import { VECTORS_PATH, buildContrastVectors } from '../src/vectors.ts';

describe('buildContrastVectors', () => {
  const vectors = buildContrastVectors();

  it('is deterministic and ASCII text', () => {
    expect(buildContrastVectors()).toEqual(vectors);
    expect(JSON.stringify(vectors)).toMatch(/^[ -~]*$/);
  });

  it('lists contrast ratios rounded to two decimals from the TypeScript implementation', () => {
    expect(vectors.contrast.length).toBeGreaterThanOrEqual(10);
    for (const row of vectors.contrast) {
      expect(row.ratio).toBe(Math.round(contrastRatio(row.foreground, row.background) * 100) / 100);
    }
    expect(vectors.contrast).toContainEqual({ foreground: '#000000', background: '#FFFFFF', ratio: 21 });
    expect(vectors.contrast).toContainEqual({ foreground: '#FFFFFF', background: '#FFFFFF', ratio: 1 });
  });

  it('records the verdict of the web overlay validator for every overlay case', () => {
    for (const row of vectors.overlays) {
      const result = validateTenantOverlay(TOKENS, row.overlay);
      expect(row.accepted).toBe(result.ok);
      const codes = result.ok ? [] : [...new Set(result.findings.map((finding) => finding.code))].sort();
      expect(row.codes).toEqual(codes);
    }
  });

  it('covers the 3.2:1 rejection, the 4.5:1 boundary and every kind of refused value', () => {
    const byName = new Map(vectors.overlays.map((row) => [row.name, row]));
    expect(byName.get('contrast 3.19 on menu')).toMatchObject({ accepted: false, codes: ['CONTRAST'] });
    expect(byName.get('contrast 4.48 on menu')).toMatchObject({ accepted: false, codes: ['CONTRAST'] });
    expect(byName.get('contrast 4.54 on menu')).toMatchObject({ accepted: true, codes: [] });
    expect(byName.get('empty overlay')).toMatchObject({ accepted: true });
    expect(byName.get('url value')).toMatchObject({ accepted: false, codes: ['FORBIDDEN_VALUE'] });
    expect(byName.get('javascript value')).toMatchObject({ accepted: false, codes: ['FORBIDDEN_VALUE'] });
    expect(byName.get('named colour')).toMatchObject({ accepted: false, codes: ['BAD_COLOR'] });
    expect(byName.get('rgb function')).toMatchObject({ accepted: false, codes: ['BAD_COLOR'] });
    expect(byName.get('unknown token')).toMatchObject({ accepted: false, codes: ['UNKNOWN_TOKEN'] });
    expect(byName.get('logo that is a URL')).toMatchObject({ accepted: false, codes: ['LOGO'] });
    expect(byName.get('three digit hex')).toMatchObject({ accepted: true });
  });

  it('knows where the committed file lives', () => {
    expect(VECTORS_PATH).toBe('packages/design-tokens/test/vectors/contrast-vectors.json');
  });
});
