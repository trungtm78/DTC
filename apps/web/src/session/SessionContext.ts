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
  /** Unread notifications shown as the badge next to "Thông báo"; absent or 0 shows no badge. */
  unreadNotifications?: number;
}

/** How strongly the session is authenticated; step-up commands need `aal2` within the last 15 minutes. */
export interface SessionAssurance {
  level: 'aal1' | 'aal2';
  /** When the session last passed the second factor. */
  aal2At?: Date;
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
  /** Permissions the membership holds as the screens know them (read-only modes); undefined means unknown. The server still decides. */
  permissions?: readonly string[];
  assurance?: SessionAssurance;
  /** Asks the user for the second factor; resolves once the session is `aal2`. */
  requestStepUp?(): Promise<void>;
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
