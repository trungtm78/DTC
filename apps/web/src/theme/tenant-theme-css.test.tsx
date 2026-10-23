import { TOKENS, kebabCase } from '@machvon/design-tokens';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_THEME, ThemeProvider } from './ThemeProvider';
import type { TenantThemeSpec } from './ThemeProvider';

const CSS = readFileSync(resolve(__dirname, '../styles/tenant-theme.css'), 'utf8');
const KEYS = ['primary', 'primaryText', 'menu', 'menuText', 'selected', 'selectedText', 'headerBg', 'headerText', 'footerBg', 'footerText', 'background', 'titleColor'] as const;
const PUBLISHED: TenantThemeSpec = { themeId: 'theme-a', version: 3, overlay: { primary: '#0B5CAD', primaryText: '#FFFFFF', menu: '#FFFFFF', menuText: '#1F2933' } };

const WITHOUT_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = WITHOUT_COMMENTS.split('}')
  .map((rule) => rule.trim())
  .filter((rule) => rule.includes('{'))
  .map((rule) => ({ selectors: rule.slice(0, rule.indexOf('{')).split(',').map((selector) => selector.trim()), body: rule.slice(rule.indexOf('{') + 1) }));
// Every selector starts with the gate of one overlay key: [data-mv-tenant-theme][data-mv-theme-keys~="key"].
const GATE = /^\[data-mv-tenant-theme\]\[data-mv-theme-keys~="([A-Za-z]+)"\]/;

function wrapperOf(theme: TenantThemeSpec): Element | null {
  const { container } = render(
    <ThemeProvider base={TOKENS} theme={theme}>
      <p>screen</p>
    </ThemeProvider>,
  );
  return container.querySelector('[data-mv-tenant-theme]');
}

describe('tenant theme variables reach the screen', () => {
  it('maps all twelve theme colours onto the prototype elements it themes', () => {
    for (const key of KEYS) expect(CSS).toContain(`var(--mv-theme-${kebabCase(key)})`);
  });

  it('gates every rule on the one overlay key whose variable it reads, so an unset colour stays the prototype colour', () => {
    expect(RULES.length).toBeGreaterThan(10);
    for (const rule of RULES) {
      const keys = new Set<string>();
      for (const selector of rule.selectors) {
        const gate = GATE.exec(selector);
        expect(gate, selector).not.toBeNull();
        keys.add(gate?.[1] ?? '');
      }
      // One key per rule, and the variables in the declarations are that key's variable only.
      expect(keys.size).toBe(1);
      const key = [...keys][0] ?? '';
      expect(KEYS).toContain(key);
      const variables = [...rule.body.matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]);
      expect(variables.length).toBeGreaterThan(0);
      for (const variable of variables) expect(variable).toBe(`--mv-theme-${kebabCase(key)}`);
    }
  });

  it('lists exactly the overlay keys on the wrapper of a published theme, and none for the base theme', () => {
    expect(wrapperOf(PUBLISHED)?.getAttribute('data-mv-theme-keys')?.split(' ').sort()).toEqual(['menu', 'menuText', 'primary', 'primaryText']);
  });

  it('puts no key on the wrapper of the base theme, so no mapping rule matches it', () => {
    const wrapper = wrapperOf(BASE_THEME);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute('data-mv-theme-keys') ?? '').toBe('');
    for (const rule of RULES) for (const selector of rule.selectors) expect(wrapper?.matches(selector.split(' ')[0] ?? '')).toBe(false);
  });

  it('matches a rule of a set key and not a rule of an unset key on the same wrapper', () => {
    const wrapper = wrapperOf(PUBLISHED);
    expect(wrapper?.matches('[data-mv-tenant-theme][data-mv-theme-keys~="menuText"]')).toBe(true);
    expect(wrapper?.matches('[data-mv-tenant-theme][data-mv-theme-keys~="headerText"]')).toBe(false);
  });

  it('defines only the variables of the overlay on the wrapper', () => {
    const { container } = render(
      <ThemeProvider base={TOKENS} theme={PUBLISHED}>
        <p>screen</p>
      </ThemeProvider>,
    );
    const style = container.querySelector('style')?.textContent ?? '';
    expect(style).toContain('[data-mv-tenant-theme]');
    expect(style).toContain('--mv-theme-primary: #0B5CAD;');
    expect(style).toContain('--mv-theme-menu-text: #1F2933;');
    expect(style).not.toContain('--mv-theme-header-text');
    expect(style).not.toContain('--mv-theme-title-color');
  });
});
