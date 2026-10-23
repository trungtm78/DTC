import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import viCatalogue from './i18n/vi.json';

describe('main', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/');
  });

  it('mounts the application into #root', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('./main');
    expect(await screen.findByRole('navigation', { name: viCatalogue['shell.nav.main.label'] })).toBeInTheDocument();
  });

  it('fails with a clear error when #root is missing', async () => {
    await expect(import('./main')).rejects.toThrow('#root');
  });
});
