import { describe, expect, it } from 'vitest';
import { PRESET_IDS, applyPreset, clampText, colourOrKeep, isTextField, issuesOfProblem, sameTheme, themeIssues } from './rules';
import type { ThemeConfig } from './types';

const THEME: ThemeConfig = {
  name: 'Agency',
  title: 'Agency portal',
  subtitle: '',
  header: 'Agency',
  footer: '',
  address: '',
  email: '',
  phone: '',
  primary: '#0b5cad',
  primaryText: '#ffffff',
  menu: '#102a43',
  menuText: '#ffffff',
  selected: '#e6f0fa',
  selectedText: '#102a43',
  headerBg: '#ffffff',
  headerText: '#102a43',
  footerBg: '#f1f5f9',
  footerText: '#102a43',
  background: '#ffffff',
  titleColor: '#102a43',
  logoAssetId: null,
};
const withValue = (patch: Partial<ThemeConfig>): ThemeConfig => ({ ...THEME, ...patch });

describe('themeIssues', () => {
  it('finds nothing wrong with a theme that holds every rule', () => {
    expect(themeIssues(THEME)).toEqual([]);
  });

  it('reports a pair under 4.5:1 with the pair and the ratio, and accepts one at 4.5:1', () => {
    const weak = themeIssues(withValue({ primary: '#8c8c8c', primaryText: '#ffffff' }));
    expect(weak).toEqual([expect.objectContaining({ kind: 'CONTRAST', token: 'primaryText', against: 'primary' })]);
    expect(weak[0]?.ratio).toBeGreaterThan(3);
    expect(weak[0]?.ratio).toBeLessThan(4.5);
    expect(themeIssues(withValue({ primary: '#767676', primaryText: '#ffffff' }))).toEqual([]);
  });

  it('reports a colour that could become CSS, a colour that is not hex and a logo that is not an asset id', () => {
    expect(themeIssues(withValue({ primary: 'url(https://evil.example/a.png)' }))).toEqual([{ kind: 'FORBIDDEN_VALUE', token: 'primary' }]);
    expect(themeIssues(withValue({ menu: 'red' }))).toEqual([{ kind: 'BAD_COLOR', token: 'menu' }]);
    expect(themeIssues(withValue({ logoAssetId: 'https://x.example/logo.png' }))).toEqual([{ kind: 'LOGO', token: 'logoAssetId' }]);
    expect(themeIssues(withValue({ logoAssetId: '00000000-0000-4000-8000-0000000000a1' }))).toEqual([]);
  });

  it('reports an empty required text and an email that is not one', () => {
    expect(themeIssues(withValue({ name: '  ', header: '' }))).toEqual([
      { kind: 'REQUIRED', token: 'name' },
      { kind: 'REQUIRED', token: 'header' },
    ]);
    expect(themeIssues(withValue({ email: 'not an email' }))).toEqual([{ kind: 'EMAIL', token: 'email' }]);
    expect(themeIssues(withValue({ email: 'office@agency.example' }))).toEqual([]);
  });
});

describe('issuesOfProblem', () => {
  it('reads the findings of a 422 answer and drops what it does not understand', () => {
    expect(
      issuesOfProblem({ findings: [{ code: 'CONTRAST', token: 'primaryText', against: 'primary', ratio: 3.2 }, { code: 'BAD_COLOR', token: 'menu' }, { code: 'SOMETHING' }, 'x', null, { code: 5 }] }),
    ).toEqual([{ kind: 'CONTRAST', token: 'primaryText', against: 'primary', ratio: 3.2 }, { kind: 'BAD_COLOR', token: 'menu' }]);
    expect(issuesOfProblem({})).toEqual([]);
    expect(issuesOfProblem({ findings: 'no' })).toEqual([]);
  });
});

describe('form helpers', () => {
  it('offers the three palettes, each changing the accent and selected pairs only', () => {
    expect(PRESET_IDS).toEqual(['ruby', 'navy', 'emerald']);
    const navy = applyPreset(THEME, 'navy');
    expect(navy).toMatchObject({ primary: '#244c78', selected: '#eaf1f8', menu: THEME.menu, name: THEME.name });
    for (const preset of PRESET_IDS) expect(themeIssues(applyPreset(THEME, preset))).toEqual([]);
  });

  it('cuts a text at the length of the contract and knows its text fields', () => {
    expect(clampText('name', 'x'.repeat(200))).toHaveLength(160);
    expect(clampText('footer', 'x'.repeat(400))).toHaveLength(300);
    expect(isTextField('email')).toBe(true);
    expect(isTextField('primary')).toBe(false);
  });

  it('keeps the colour it had for a value that is not #rrggbb', () => {
    expect(colourOrKeep('#AABBCC', '#000000')).toBe('#AABBCC');
    expect(colourOrKeep('#abc', '#000000')).toBe('#000000');
    expect(colourOrKeep('blue', '#000000')).toBe('#000000');
  });

  it('compares two themes field by field', () => {
    expect(sameTheme(THEME, { ...THEME })).toBe(true);
    expect(sameTheme(THEME, withValue({ title: 'Other' }))).toBe(false);
    expect(sameTheme(THEME, { ...THEME, extra: 'x' } as ThemeConfig)).toBe(false);
  });
});
