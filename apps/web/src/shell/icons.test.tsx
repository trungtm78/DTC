import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import prototypeSource from '@design/02_Prototype/workspace-navigation.js?raw';
import { Icon } from './Icon';
import { ICON_PATHS } from './icons';
import type { IconName } from './icons';

describe('shell icons', () => {
  it.each(Object.entries(ICON_PATHS))('keeps the %s symbol equal to the prototype source', (_name, markup) => {
    expect(prototypeSource).toContain(markup);
  });

  it('draws a decorative 24 by 24 svg from the symbol markup', () => {
    const { container } = render(<Icon name="home" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.innerHTML).toContain('path');
  });

  it('draws every named icon', () => {
    for (const name of Object.keys(ICON_PATHS) as IconName[]) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')?.children.length).toBeGreaterThan(0);
      unmount();
    }
  });
});
