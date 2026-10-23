import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import vi from '../i18n/vi.json';
import { NotFound } from './NotFound';
import { resolveScreen, routeById, routeByPath } from './registry';
import { WEB_ROUTES } from './routes.generated.ts';
import type { ScreenLoader, ScreenProps } from './types.ts';

function home() {
  const route = routeById('HOME-01');
  if (route === undefined) throw new Error('HOME-01 missing from the route table');
  return route;
}

describe('route lookup', () => {
  it('finds a route by id and by path, ignoring case and a trailing slash', () => {
    expect(routeById('ADM-01')?.path).toBe('/adm/adm-01');
    expect(routeByPath('/adm/adm-01')?.id).toBe('ADM-01');
    expect(routeByPath('/ADM/ADM-01/')?.id).toBe('ADM-01');
    expect(routeByPath('/')).toBeUndefined();
  });

  it('knows nothing for an unknown id or path', () => {
    expect(routeById('NOPE-01')).toBeUndefined();
    expect(routeByPath('/adm/nope')).toBeUndefined();
  });

  it('has a route for every module screen of the table', () => {
    expect(WEB_ROUTES).toHaveLength(406);
  });
});

describe('resolveScreen', () => {
  it('renders the not-implemented screen with title, id and requirement for a screen without an implementation', () => {
    const Screen = resolveScreen('HOME-01');
    render(<Screen route={home()} />);
    expect(screen.getByRole('heading', { level: 1, name: home().title })).toBeInTheDocument();
    expect(screen.getByText(vi['shell.screen.notImplemented.title'])).toBeInTheDocument();
    expect(screen.getByText(vi['shell.screen.notImplemented.body'])).toBeInTheDocument();
    expect(screen.getByText('HOME-01')).toBeInTheDocument();
    expect(screen.getByText(/FR-HOME-01/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-screen-id', 'HOME-01');
  });

  it('omits the requirement when the route has none', () => {
    const Screen = resolveScreen('HOME-01');
    render(<Screen route={{ ...home(), req: null }} />);
    expect(screen.queryByText(/FR-/)).not.toBeInTheDocument();
  });

  it('loads a registered implementation lazily and gives the same component for the same loader', async () => {
    const Implemented = ({ route }: ScreenProps) => <h1>{`Implemented ${route.id}`}</h1>;
    const loader: ScreenLoader = () => Promise.resolve({ default: Implemented });
    const modules = { 'HOME-01': loader };
    const Screen = resolveScreen('HOME-01', modules);
    expect(resolveScreen('HOME-01', modules)).toBe(Screen);
    render(
      <Suspense fallback={<p>waiting</p>}>
        <Screen route={home()} />
      </Suspense>,
    );
    expect(await screen.findByRole('heading', { name: 'Implemented HOME-01' })).toBeInTheDocument();
  });

  it('keeps the fallback for ids the registry does not hold', () => {
    const modules = { 'ADM-01': (() => Promise.resolve({ default: () => null })) as ScreenLoader };
    expect(resolveScreen('HOME-01', modules)).not.toBe(resolveScreen('ADM-01', modules));
  });
});

describe('NotFound', () => {
  it('announces that the address is not in the screen catalogue', () => {
    render(<NotFound />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: vi['shell.notFound.title'] })).toBeInTheDocument();
    expect(screen.getByText(vi['shell.notFound.body'])).toBeInTheDocument();
  });
});

describe('catalogues', () => {
  it('hold the shell route keys in both languages', () => {
    for (const key of ['shell.screen.notImplemented.title', 'shell.screen.notImplemented.body', 'shell.notFound.title', 'shell.notFound.body'] as const) {
      expect(vi[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
});
