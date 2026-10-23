import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ApiClientProvider } from '../../api/ApiClientContext';
import { ALL_MODULES_VISIBLE } from '../../navigation/model';
import type { WebRoute } from '../../routes/types';
import { SessionContext } from '../../session/SessionContext';
import type { SessionValue } from '../../session/SessionContext';
import { harness } from '../sas/test-support';
import type { Harness } from '../sas/test-support';

export { harness };
export type { Harness };

export const TENANT = { id: '00000000-0000-4000-8000-00000000000a', name: 'Cao Bang', monogram: 'CB', membershipId: '00000000-0000-4000-8000-000000000001', theme: { themeId: 'tenant', version: 1, overlay: {} } };

export const CLERK = ['doc.register.manage', 'doc.register.read', 'doc.type.manage'];
export const READER = ['doc.register.read'];

export function routeOf(id: string, req: string): WebRoute {
  return { id, path: `/doc/${id.toLowerCase()}`, title: id, kind: 'table', area: 'overview', module: 'DOC', group: 'Documents', role: 'workspace', parent: null, req };
}

export function mount(screen: ReactElement, h: Harness, permissions: readonly string[] | undefined = CLERK, path = '/'): RenderResult & { queries: QueryClient } {
  const session: SessionValue = {
    tenant: TENANT,
    tenants: [TENANT],
    user: { displayName: 'Clerk', initials: 'CK' },
    access: ALL_MODULES_VISIBLE,
    switchTenant: () => undefined,
    getSession: () => Promise.resolve({ token: 'token' }),
    permissions,
  };
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    queries,
    ...render(
      <SessionContext.Provider value={session}>
        <QueryClientProvider client={queries}>
          <ApiClientProvider client={h.client}>
            <MemoryRouter initialEntries={[path]}>{screen}</MemoryRouter>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionContext.Provider>,
    ),
  };
}
