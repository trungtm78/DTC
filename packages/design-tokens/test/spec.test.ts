import { readFileSync } from 'node:fs';
import { CONTRAST_PAIRS, MIN_TEXT_CONTRAST, THEME_COLOR_KEYS } from '../src/theme-rules.ts';
import { PROTOTYPE_THEME_PATH, THEME_SPEC_PATH } from './support.ts';

/** The theme rules in code must be the rules of the design package: the spec page and the prototype it describes. */
describe('theme rules match the design package', () => {
  const spec = readFileSync(THEME_SPEC_PATH, 'utf8');
  const prototype = readFileSync(PROTOTYPE_THEME_PATH, 'utf8');

  it('lists the twelve colour keys of the prototype in the same order', () => {
    const match = /const themeColorKeys=\[([^\]]+)\]/.exec(prototype);
    expect(match).not.toBeNull();
    const keys = (match?.[1] ?? '').split(',').map((key) => key.trim().replace(/'/g, ''));
    expect([...THEME_COLOR_KEYS]).toEqual(keys);
  });

  it('lists the six text on background pairs of the prototype validation', () => {
    const match = /const pairs=\[(\[.*?\])\]\.map/.exec(prototype);
    expect(match).not.toBeNull();
    const pairs = [...(match?.[1] ?? '').matchAll(/\['(\w+)','(\w+)','[^']*'\]/g)].map(([, foreground, background]) => ({ foreground, background }));
    expect(CONTRAST_PAIRS.map(({ foreground, background }) => ({ foreground, background }))).toEqual(pairs);
    expect(CONTRAST_PAIRS).toHaveLength(6);
  });

  it('states the 4.5:1 minimum, six pairs and hex-only colours (the spec page)', () => {
    expect(MIN_TEXT_CONTRAST).toBe(4.5);
    expect(spec).toContain('Sáu cặp màu văn bản/nền đạt ít nhất 4,5:1');
    expect(spec).toContain('màu chỉ chấp nhận token HEX hợp lệ');
    expect(spec).toContain('Chặn SVG và URL tải ngoài');
  });

  it('uses the prototype minimum in its own check', () => {
    expect(prototype).toContain('p.ratio<4.5');
  });
});
