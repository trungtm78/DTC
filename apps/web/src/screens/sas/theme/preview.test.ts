import { TOKENS } from '@machvon/design-tokens';
import { describe, expect, it } from 'vitest';
import { PREVIEW_TEXT_KEYS, previewDocument } from './preview';
import type { PreviewText } from './preview';
import type { ThemeConfig } from './types';

const THEME: ThemeConfig = {
  name: 'Agency',
  title: 'Agency portal',
  subtitle: 'A subtitle',
  header: 'Header text',
  footer: 'Footer text',
  address: 'Street 1',
  email: 'office@agency.example',
  phone: '0123',
  primary: '#0b5cad',
  primaryText: '#ffffff',
  menu: '#102a43',
  menuText: '#ffffff',
  selected: '#e6f0fa',
  selectedText: '#102a43',
  headerBg: '#fefefe',
  headerText: '#102a43',
  footerBg: '#f1f5f9',
  footerText: '#102a43',
  background: '#fafafa',
  titleColor: '#102a43',
  logoAssetId: null,
};
const TEXT: PreviewText = Object.fromEntries(PREVIEW_TEXT_KEYS.map((key) => [key, key.toUpperCase()])) as PreviewText;

describe('previewDocument', () => {
  it('builds a stand-alone page in the colours and texts of the theme', () => {
    const html = previewDocument(THEME, 'web', TEXT, 'vi');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    for (const colour of ['#0b5cad', '#102a43', '#fefefe', '#fafafa', '#f1f5f9']) expect(html).toContain(colour);
    for (const text of ['Header text', 'Agency portal', 'A subtitle', 'Footer text', 'Street 1', 'office@agency.example']) expect(html).toContain(text);
    expect(html).toContain('lang="vi"');
  });

  it('puts every text in as text: the markup of a text never becomes markup', () => {
    const html = previewDocument({ ...THEME, title: '<script>alert(1)</script>', name: '"><img src=x onerror=alert(1)>' }, 'web', TEXT, 'vi');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never lets a value that is not a hex colour reach the style: the base colour shows instead', () => {
    const html = previewDocument({ ...THEME, primary: 'url(https://evil.example/a.png)', menu: 'red;}</style><script>x</script>' }, 'web', TEXT, 'vi');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<script');
    expect(html).toContain(TOKENS.tenantTheme.primary);
    expect(html).toContain(TOKENS.tenantTheme.menu);
  });

  it('lays the smartphone preview out in one column', () => {
    expect(previewDocument(THEME, 'phone', TEXT, 'vi')).toContain('grid-template-columns:1fr');
    expect(previewDocument(THEME, 'web', TEXT, 'vi')).toContain('grid-template-columns:140px 1fr');
  });

  it('shows the first two letters of the name in the mark', () => {
    expect(previewDocument(THEME, 'web', TEXT, 'vi')).toContain('>AG<');
  });
});
