import type { SessionTenant, SessionUser } from './SessionContext';

/**
 * Appears in the development session module only; the production bundle test searches the build output for it,
 * so it must never be exported from, or inlined into, a module the production entry imports.
 */
export const DEV_SESSION_MARKER = 'mv-dev-session-provider-7f3a';

const FIXTURE_MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';

/** Two fixture tenants (TNT-A and TNT-B of test_fixtures.json) with different published themes. */
export const DEV_TENANTS: readonly SessionTenant[] = [
  {
    id: '00000000-0000-4000-8000-00000000000a',
    name: 'Cao Bằng',
    monogram: 'CB',
    membershipId: FIXTURE_MEMBERSHIP,
    theme: { themeId: 'theme-cao-bang', version: 2, overlay: { primary: '#B4233D', primaryText: '#FFFFFF' } },
  },
  {
    id: '00000000-0000-4000-8000-00000000000b',
    name: 'Lào Cai',
    monogram: 'LC',
    membershipId: FIXTURE_MEMBERSHIP,
    theme: { themeId: 'theme-lao-cai', version: 5, overlay: { primary: '#0B5CAD', primaryText: '#FFFFFF' } },
  },
];

/** The development user starts with three unread notifications, as the mockup shows. */
export const DEV_USER: SessionUser = { displayName: 'Nguyễn An', initials: 'AN', unreadNotifications: 3 };

/**
 * The tenants of the development session for an address query: one tenant by default (so the sidebar matches the
 * mockup), both fixture tenants with `?tenants=2` for the tenant-switch flows.
 */
export function devTenantsFor(search: string): readonly SessionTenant[] {
  const both = new URLSearchParams(search).get('tenants') === '2';
  return both ? DEV_TENANTS : DEV_TENANTS.slice(0, 1);
}
