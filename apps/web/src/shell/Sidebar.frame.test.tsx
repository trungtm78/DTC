import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import vi_ from '../i18n/vi.json';
import { DEV_TENANTS, devTenantsFor } from '../session/dev-tenants';
import { mockMatchMedia, renderApp, TENANT_A } from '../test/render';

const MAIN_NAV = vi_['shell.nav.main.label'];

beforeEach(() => {
  window.localStorage.clear();
  mockMatchMedia(() => false);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function destination(name: string): HTMLElement {
  const sidebar = screen.getByRole('navigation', { name: MAIN_NAV });
  const wrapper = within(sidebar).getByRole('link', { name: new RegExp(`^${name}`) }).closest('.sidebar-destination');
  if (!(wrapper instanceof HTMLElement)) throw new Error(`no destination for ${name}`);
  return wrapper;
}

describe('active sidebar item of screens that are not a destination themselves', () => {
  it.each(['HOME-03', 'HOME-08', 'HOME-10'])('keeps the overview destination active on %s without marking it as the current page', (id) => {
    renderApp(`/home/${id.toLowerCase()}`);
    const overview = destination(vi_['shell.nav.home.label']);
    expect(overview).toHaveClass('destination-active');
    expect(within(overview).getByRole('link')).not.toHaveAttribute('aria-current');
  });

  it('marks only "Việc của tôi" on HOME-02 and only the overview on HOME-01', () => {
    renderApp('/home/home-02');
    expect(destination(vi_['shell.nav.tasks.label'])).toHaveClass('destination-active');
    expect(destination(vi_['shell.nav.home.label'])).not.toHaveClass('destination-active');
    cleanup();
    renderApp('/home/home-01');
    expect(destination(vi_['shell.nav.home.label'])).toHaveClass('destination-active');
    expect(destination(vi_['shell.nav.tasks.label'])).not.toHaveClass('destination-active');
  });

  it('highlights the module link and opens its shortcuts on a child screen of another module', () => {
    renderApp('/prj/prj-07');
    expect(destination('Dự án')).toHaveClass('destination-active');
  });
});

describe('unread notification badge', () => {
  it('shows the count of the session user next to "Thông báo"', () => {
    renderApp('/home/home-01', { session: { user: { displayName: 'Nguyễn An', initials: 'AN', unreadNotifications: 3 } } });
    expect(within(destination(vi_['shell.nav.notifications.label'])).getByText('3')).toHaveClass('nav-count');
  });

  it('shows no badge without unread notifications', () => {
    renderApp('/home/home-01', { session: { user: { displayName: 'Nguyễn An', initials: 'AN', unreadNotifications: 0 } } });
    expect(document.querySelector('.nav-count')).toBeNull();
    cleanup();
    renderApp('/home/home-01');
    expect(document.querySelector('.nav-count')).toBeNull();
  });
});

describe('pinned screens manager', () => {
  it('has a button next to the heading that lists the pinned screens', async () => {
    const user = userEvent.setup();
    renderApp('/home/home-01');
    await user.click(screen.getByRole('button', { name: vi_['shell.nav.pinned.manage.label'] }));
    const dialog = screen.getByRole('dialog', { name: vi_['shell.favourites.title'] });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: new RegExp(vi_['shell.favourites.up.label'].replace('{id}', 'DIS-15')) })).toBeDisabled();
  });

  it('moves a pinned screen down, unpins another, and persists the order', async () => {
    const user = userEvent.setup();
    renderApp('/home/home-01');
    await user.click(screen.getByRole('button', { name: vi_['shell.nav.pinned.manage.label'] }));
    const dialog = screen.getByRole('dialog', { name: vi_['shell.favourites.title'] });
    await user.click(within(dialog).getByRole('button', { name: vi_['shell.favourites.down.label'].replace('{id}', 'DIS-15') }));
    expect(JSON.parse(window.localStorage.getItem('investment-favorites') ?? '[]')).toEqual(['BI-02', 'DIS-15']);
    await user.click(within(dialog).getByRole('button', { name: vi_['shell.favourites.remove.label'].replace('{id}', 'BI-02') }));
    expect(JSON.parse(window.localStorage.getItem('investment-favorites') ?? '[]')).toEqual(['DIS-15']);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: vi_['shell.favourites.title'] })).toBeNull());
  });

  it('says so when nothing is pinned', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('investment-favorites', '[]');
    renderApp('/home/home-01');
    await user.click(screen.getByRole('button', { name: vi_['shell.nav.pinned.manage.label'] }));
    expect(within(screen.getByRole('dialog', { name: vi_['shell.favourites.title'] })).getByText(vi_['shell.favourites.empty.text'])).toBeInTheDocument();
  });

  it('has English wording for every manager key', () => {
    for (const key of Object.keys(vi_).filter((name) => name.startsWith('shell.favourites.') || name === 'shell.nav.pinned.manage.label')) {
      expect(en).toHaveProperty([key]);
    }
  });
});

describe('account link', () => {
  it('ends with the three-dot marker of the prototype', () => {
    renderApp('/home/home-01');
    const account = screen.getByRole('link', { name: vi_['shell.account.open.label'] });
    expect(account.lastElementChild?.textContent).toBe('···');
  });
});

describe('development tenants', () => {
  it('starts with one tenant, so the sidebar shows no tenant switcher', () => {
    expect(devTenantsFor('')).toEqual([DEV_TENANTS[0]]);
    expect(devTenantsFor('?other=1')).toEqual([DEV_TENANTS[0]]);
    renderApp('/home/home-01', { tenants: devTenantsFor('') });
    expect(screen.queryByRole('combobox', { name: vi_['shell.tenant.switch.label'] })).toBeNull();
  });

  it('offers both fixture tenants with ?tenants=2', async () => {
    expect(devTenantsFor('?tenants=2')).toEqual([...DEV_TENANTS]);
    expect(devTenantsFor('?x=1&tenants=2')).toEqual([...DEV_TENANTS]);
    renderApp('/home/home-01', { tenants: devTenantsFor('?tenants=2') });
    const switcher = screen.getByRole('combobox', { name: vi_['shell.tenant.switch.label'] });
    await act(async () => userEvent.selectOptions(switcher, DEV_TENANTS[1]?.id ?? ''));
    expect(document.querySelector('.tenant-name strong')).toHaveTextContent(DEV_TENANTS[1]?.name ?? '');
    expect(TENANT_A.name).not.toBe(DEV_TENANTS[1]?.name);
  });
});
