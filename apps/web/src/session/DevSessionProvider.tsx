import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ALL_MODULES_VISIBLE } from '../navigation/model';
import { DEV_SESSION_MARKER, DEV_TENANTS, DEV_USER } from './dev-tenants';
import { signDevToken } from './dev-token';
import { SessionContext } from './SessionContext';
import type { SessionTenant, SessionValue } from './SessionContext';

export interface DevSessionProviderProps {
  children: ReactNode;
  tenants?: readonly SessionTenant[];
  /** Base64 of at least 32 bytes shared with the development API; defaults to VITE_DEV_SESSION_KEY. */
  keyBase64?: string;
}

/**
 * A development stand-in for sign-in: a fixed user with two tenants and a locally signed token for the development
 * API. It is only imported when `import.meta.env.DEV` is true, so production bundles never contain it.
 */
export default function DevSessionProvider({ children, tenants = DEV_TENANTS, keyBase64 = import.meta.env.VITE_DEV_SESSION_KEY }: DevSessionProviderProps) {
  const [tenantId, setTenantId] = useState<string | undefined>(tenants[0]?.id);
  const tenant = tenants.find((candidate) => candidate.id === tenantId);

  const getSession = useCallback(async () => {
    if (tenant === undefined || keyBase64 === undefined || keyBase64 === '') return undefined;
    return { token: await signDevToken({ tenantId: tenant.id, membershipId: tenant.membershipId, scopeVersion: 1 }, keyBase64) };
  }, [tenant, keyBase64]);

  const switchTenant = useCallback(
    (nextId: string) => {
      if (tenants.some((candidate) => candidate.id === nextId)) setTenantId(nextId);
    },
    [tenants],
  );

  const value = useMemo<SessionValue>(
    () => ({ tenant, tenants, user: DEV_USER, access: ALL_MODULES_VISIBLE, switchTenant, getSession }),
    [tenant, tenants, switchTenant, getSession],
  );

  return (
    <SessionContext.Provider value={value}>
      <span hidden data-dev-session={DEV_SESSION_MARKER} />
      {children}
    </SessionContext.Provider>
  );
}
