import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import viCatalogue from './i18n/vi.json';

// Importing main after resetModules loads the whole application cold (every module, under coverage), which can take
// several seconds on a busy machine: this test and the missing-root one wait for that import explicitly.
const COLD_IMPORT_TIMEOUT_MS = 30_000;

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
    expect(await screen.findByRole('navigation', { name: viCatalogue['shell.nav.main.label'] }, { timeout: COLD_IMPORT_TIMEOUT_MS })).toBeInTheDocument();
  }, COLD_IMPORT_TIMEOUT_MS);

  it('fails with a clear error when #root is missing', async () => {
    await expect(import('./main')).rejects.toThrow('#root');
  }, COLD_IMPORT_TIMEOUT_MS);
});
