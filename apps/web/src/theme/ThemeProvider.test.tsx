import { TOKENS } from '@machvon/design-tokens';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import vi_ from '../i18n/vi.json';
import { BASE_THEME, ThemeProvider, useTheme } from './ThemeProvider';
import type { TenantThemeSpec } from './ThemeProvider';

const GOOD: TenantThemeSpec = { themeId: 'theme-a', version: 3, overlay: { primary: '#0B5CAD', primaryText: '#FFFFFF' } };
const OTHER: TenantThemeSpec = { themeId: 'theme-b', version: 7, overlay: { primary: '#1F6F43', primaryText: '#FFFFFF' } };
// White text on a light primary is about 1.5:1, far under the 4.5:1 the theme rules require.
const LOW_CONTRAST: TenantThemeSpec = { themeId: 'theme-bad', version: 1, overlay: { primary: '#CCCCCC', primaryText: '#FFFFFF' } };
const FORBIDDEN: TenantThemeSpec = { themeId: 'theme-evil', version: 1, overlay: { primary: 'url(https://x.example/a.png)' } };

function Probe() {
  const theme = useTheme();
  return (
    <p data-testid="probe">
      {theme.themeId}@{theme.themeVersion}:{String(theme.rejected)}
    </p>
  );
}

const wrapper = (theme: TenantThemeSpec, children = <Probe />) => (
  <ThemeProvider base={TOKENS} theme={theme}>
    {children}
  </ThemeProvider>
);

describe('ThemeProvider', () => {
  it('applies a valid overlay: the id and version are the published ones and the css targets the wrapper', () => {
    const { container } = render(wrapper(GOOD));
    expect(screen.getByTestId('probe')).toHaveTextContent('theme-a@3:false');
    const root = container.querySelector('[data-mv-tenant-theme]');
    expect(root).not.toBeNull();
    expect(container.querySelector('style')?.textContent).toContain('[data-mv-tenant-theme]');
    expect(container.querySelector('style')?.textContent).toContain('#0B5CAD');
    expect(screen.queryByText(vi_['theme.overlay.rejected'])).toBeNull();
  });

  it('switches to another tenant theme and reports its id and version', () => {
    const { rerender } = render(wrapper(GOOD));
    rerender(wrapper(OTHER));
    expect(screen.getByTestId('probe')).toHaveTextContent('theme-b@7:false');
  });

  it('keeps the previous theme and tells the user when an overlay is rejected', () => {
    const { rerender, container } = render(wrapper(GOOD));
    rerender(wrapper(LOW_CONTRAST));
    expect(screen.getByTestId('probe')).toHaveTextContent('theme-a@3:true');
    expect(screen.getByRole('status')).toHaveTextContent(vi_['theme.overlay.rejected']);
    expect(container.querySelector('style')?.textContent).toContain('#0B5CAD');
    expect(container.querySelector('style')?.textContent).not.toContain('#CCCCCC');
  });

  it('never applies a forbidden value, and falls back to the base theme when nothing valid came before', () => {
    const { container } = render(wrapper(FORBIDDEN));
    expect(screen.getByTestId('probe')).toHaveTextContent(`${BASE_THEME.themeId}@${BASE_THEME.version}:true`);
    expect(container.querySelector('style')).toBeNull();
    expect(container.innerHTML).not.toContain('url(');
  });

  it('recovers when a valid overlay follows a rejected one', () => {
    const { rerender } = render(wrapper(LOW_CONTRAST));
    rerender(wrapper(OTHER));
    expect(screen.getByTestId('probe')).toHaveTextContent('theme-b@7:false');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not remount its children when the theme changes, so an open form keeps its values', async () => {
    function Form() {
      const [value, setValue] = useState('');
      return <input aria-label="note" value={value} onChange={(event) => setValue(event.target.value)} />;
    }
    const { rerender } = render(wrapper(GOOD, <Form />));
    await userEvent.type(screen.getByLabelText('note'), 'draft');
    rerender(wrapper(OTHER, <Form />));
    expect(screen.getByLabelText('note')).toHaveValue('draft');
  });
});
