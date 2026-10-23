import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import vi_ from './i18n/vi.json';
import { renderApp } from './test/render';

function ChooserStub() {
  const location = useLocation();
  return <p data-testid="chooser">{`${location.pathname}${location.search}`}</p>;
}

const SCREENS = {
  'IAM-04': () => Promise.resolve({ default: ChooserStub as never }),
  'ADM-01': () => Promise.resolve({ default: (() => <p>units screen</p>) as never }),
};

afterEach(cleanup);

describe('routing with a real sign-in', () => {
  it('offers the way in on every screen while nobody is signed in, and starts the sign-in at that address', async () => {
    const signIn = vi.fn(() => Promise.resolve());
    renderApp('/adm/adm-01?x=1', { screens: SCREENS, session: { tenant: undefined, status: 'signedOut', signIn } });
    expect(screen.queryByText('units screen')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: vi_['session.oidc.signIn.action'] }));
    expect(signIn).toHaveBeenCalledWith({ returnTo: '/adm/adm-01?x=1' });
  });

  it('sends a person who is known but has not chosen a tenant to the chooser, remembering the screen they came for', async () => {
    renderApp('/adm/adm-01?x=1', { screens: SCREENS, session: { tenant: undefined, status: 'identified' } });
    await waitFor(() => expect(screen.getByTestId('chooser').textContent).toBe(`/iam/iam-04?next=${encodeURIComponent('/adm/adm-01?x=1')}`));
    expect(screen.queryByText('units screen')).toBeNull();
  });

  it('opens the chooser itself for a person without a tenant', async () => {
    renderApp('/iam/iam-04', { screens: SCREENS, session: { tenant: undefined, status: 'identified' } });
    expect((await screen.findByTestId('chooser')).textContent).toBe('/iam/iam-04');
  });

  it('shows the screens once a tenant is chosen', async () => {
    renderApp('/adm/adm-01', { screens: SCREENS, session: { status: 'active', signIn: vi.fn() } });
    expect(await screen.findByText('units screen')).toBeTruthy();
  });

  it('keeps the plain signed-out card for a session that cannot sign in (nothing to offer)', async () => {
    renderApp('/adm/adm-01', { screens: SCREENS, session: { tenant: undefined } });
    expect(await screen.findByRole('heading', { name: vi_['states.signedOut.title'] })).toBeTruthy();
    expect(screen.queryByRole('button', { name: vi_['session.oidc.signIn.action'] })).toBeNull();
  });

  it('serves the callback address outside the shell', async () => {
    renderApp('/auth/callback?code=c&state=s', { session: { tenant: undefined, status: 'signedOut', completeSignIn: () => new Promise(() => undefined) } });
    expect(await screen.findByRole('status', { name: vi_['session.oidc.callback.loading.label'] })).toBeTruthy();
    expect(document.querySelector('aside.sidebar')).toBeNull();
  });
});
