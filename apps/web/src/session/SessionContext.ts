import { createContext, useContext } from 'react';
import { ALL_MODULES_VISIBLE } from '../navigation/model';
import type { NavigationAccess } from '../navigation/model';
import type { TenantThemeSpec } from '../theme/ThemeProvider';

/** A tenant the signed-in user holds a membership in, as the shell needs it. */
export interface SessionTenant {
  id: string;
  name: string;
  /** Two letters in the round tenant mark of the sidebar. */
  monogram: string;
  membershipId: string;
  theme: TenantThemeSpec;
}

export interface SessionUser {
  displayName: string;
  initials: string;
}

export interface SessionValue {
  /** The selected tenant; undefined means nobody is signed in. */
  tenant: SessionTenant | undefined;
  tenants: readonly SessionTenant[];
  user: SessionUser | undefined;
  /** Modules the user may open; the server still decides every request. */
  access: NavigationAccess;
  switchTenant(tenantId: string): void;
  /** The bearer token for the API client, undefined when there is no session. */
  getSession(): Promise<{ token: string } | undefined>;
}

/** The session of a visitor who has not signed in; it is what production builds provide until OIDC sign-in lands. */
export const SIGNED_OUT: SessionValue = {
  tenant: undefined,
  tenants: [],
  user: undefined,
  access: ALL_MODULES_VISIBLE,
  switchTenant: () => undefined,
  getSession: () => Promise.resolve(undefined),
};

export const SessionContext = createContext<SessionValue>(SIGNED_OUT);

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
