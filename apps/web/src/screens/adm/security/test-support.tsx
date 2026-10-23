import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ApiClientProvider } from '../../../api/ApiClientContext';
import { ALL_MODULES_VISIBLE } from '../../../navigation/model';
import { SessionContext } from '../../../session/SessionContext';
import type { SessionTenant, SessionValue } from '../../../session/SessionContext';
import { harness } from '../../sas/test-support';
import type { Harness } from '../../sas/test-support';

export { harness };
export type { Harness };

const theme = { themeId: 'tenant', version: 1, overlay: {} };
export const FIRST_TENANT: SessionTenant = { id: '00000000-0000-4000-8000-00000000000a', name: 'Cao Bang', monogram: 'CB', membershipId: '00000000-0000-4000-8000-000000000001', theme };
export const SECOND_TENANT: SessionTenant = { id: '00000000-0000-4000-8000-00000000000b', name: 'Lao Cai', monogram: 'LC', membershipId: '00000000-0000-4000-8000-000000000002', theme };

export interface SessionOptions {
  permissions: readonly string[] | undefined;
  mode?: 'FULL' | 'READ_ONLY';
}

export type SessionChange = SessionOptions & { tenant?: SessionTenant };

/**
 * Mounts a screen in a session that can change its tenant or its mode afterwards: `rerenderWith` renders the same screen under
 * another session, the way the shell does when the person switches tenant (the screen is not remounted by the host).
 */
export function mountInSession(screen: ReactElement, h: Harness, first: SessionChange): RenderResult & { rerenderWith(options: SessionChange): void } {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = (options: SessionChange): ReactElement => {
    const tenant = options.tenant ?? FIRST_TENANT;
    const session: SessionValue = {
      tenant,
      tenants: [FIRST_TENANT, SECOND_TENANT],
      user: { displayName: 'Admin', initials: 'AD' },
      access: ALL_MODULES_VISIBLE,
      switchTenant: () => undefined,
      getSession: () => Promise.resolve({ token: 'token' }),
      permissions: options.permissions,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    };
    return (
      <SessionContext.Provider value={session}>
        <QueryClientProvider client={queries}>
          <ApiClientProvider client={h.client}>
            <MemoryRouter>{screen}</MemoryRouter>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionContext.Provider>
    );
  };
  const rendered = render(tree(first));
  return { ...rendered, rerenderWith: (options: SessionChange) => rendered.rerender(tree(options)) };
}
