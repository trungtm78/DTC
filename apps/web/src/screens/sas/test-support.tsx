import type { ApiClient } from '@machvon/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ApiClientProvider } from '../../api/ApiClientContext';
import { ALL_MODULES_VISIBLE } from '../../navigation/model';
import type { WebRoute } from '../../routes/types';
import { SessionContext } from '../../session/SessionContext';
import type { SessionValue } from '../../session/SessionContext';

export const PLATFORM_TENANT = { id: '00000000-0000-4000-8000-0000000000aa', name: 'MACHVON', monogram: 'MV', membershipId: '00000000-0000-4000-8000-0000000000e9', theme: { themeId: 'platform', version: 1, overlay: {} } };

export const SYSTEM_ADMIN = ['system.tenant.manage', 'system.tenant.read'];
export const PLATFORM_OPERATOR = ['system.tenant.read'];

export function routeOf(id: string, req: string): WebRoute {
  return { id, path: `/sas/${id.toLowerCase()}`, title: id, kind: 'list', area: 'admin', module: 'SAS', group: 'SaaS', role: 'workspace', parent: null, req };
}

export interface Harness {
  client: ApiClient;
  read: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
}

/** A client whose reads are answered by `answer(operation, input)` (a value, or a rejection by returning an Error). */
export function harness(answer: (operation: string, input: unknown) => unknown, command: (operation: string, input: unknown) => unknown = () => ({})): Harness {
  const respond = (value: unknown) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  const read = vi.fn((operation: string, input?: unknown) => respond(answer(operation, input)));
  const cmd = vi.fn((operation: string, input: unknown) => respond(command(operation, input)));
  return { client: { read, readAll: vi.fn(), command: cmd } as unknown as ApiClient, read, command: cmd };
}

export function mount(screen: ReactElement, h: Harness, permissions: readonly string[] | undefined = SYSTEM_ADMIN, path = '/'): RenderResult & { queries: QueryClient } {
  const session: SessionValue = {
    tenant: PLATFORM_TENANT,
    tenants: [PLATFORM_TENANT],
    user: { displayName: 'Admin', initials: 'AD' },
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
