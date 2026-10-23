import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import en from './i18n/en.json';
import { translator } from './i18n/index';
import viCatalogue from './i18n/vi.json';

describe('App', () => {
  afterEach(() => {
    act(() => translator.setLocale('vi'));
  });

  it('shows the localised application name and tagline, Vietnamese by default', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: viCatalogue['shell.app.name.title'] })).toBeInTheDocument();
    expect(screen.getByText(viCatalogue['shell.app.tagline.text'])).toBeInTheDocument();
  });

  it('switches to English when the locale changes', () => {
    render(<App />);
    act(() => translator.setLocale('en'));
    expect(screen.getByText(en['shell.app.tagline.text'])).toBeInTheDocument();
  });
});
