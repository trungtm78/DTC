import { createApiClient } from '@machvon/api-client';
import type { ApiClient } from '@machvon/api-client';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '../i18n';
import { useSession } from '../session/SessionContext';

const ApiClientContext = createContext<ApiClient | undefined>(undefined);

export interface ApiClientProviderProps {
  client: ApiClient;
  children: ReactNode;
}

/** Supplies a ready-made client (tests, or a host that builds its own); screens call `useApiClient()` either way. */
export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

/**
 * The client of the current session: the injected one when there is a provider, otherwise one over the API at
 * `VITE_API_BASE_URL` (the same origin when unset) that reads the bearer token of the session on every request.
 */
export function useApiClient(): ApiClient {
  const injected = useContext(ApiClientContext);
  const { getSession } = useSession();
  const { locale } = useTranslation();
  return useMemo(
    () => injected ?? createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '', session: getSession, locale: () => locale }),
    [injected, getSession, locale],
  );
}
