import { contrastRatio, relativeLuminance } from '../src/contrast.ts';

describe('contrastRatio', () => {
  it('gives 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(contrastRatio('#B4233D', '#B4233D')).toBe(1);
  });

  it('does not depend on the order of the two colours', () => {
    expect(contrastRatio('#29272D', '#F7F5F4')).toBeCloseTo(contrastRatio('#F7F5F4', '#29272D'), 10);
  });

  it('accepts the short form and any letter case', () => {
    expect(contrastRatio('#fff', '#000')).toBe(21);
    expect(contrastRatio('#AbC', '#aabbcc')).toBe(1);
  });

  it('matches known WCAG values', () => {
    // #767676 on white is the classic 4.54:1 boundary colour; #777777 on white is 4.48:1.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it.each(['', 'red', '#12', '#12345', '#1234567', '123456', '#GGGGGG', 'rgb(0,0,0)'])('refuses %p', (value) => {
    expect(() => contrastRatio(value, '#FFFFFF')).toThrow(TypeError);
    expect(() => contrastRatio('#FFFFFF', value)).toThrow(TypeError);
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
  });
});
