import type { ApiClient } from '@machvon/api-client';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_MODULES_VISIBLE } from '../navigation/model';
import { SessionContext } from '../session/SessionContext';
import type { SessionValue } from '../session/SessionContext';
import { ApiClientProvider, useApiClient } from './ApiClientContext';

const session: SessionValue = {
  tenant: undefined,
  tenants: [],
  user: undefined,
  access: ALL_MODULES_VISIBLE,
  switchTenant: () => undefined,
  getSession: () => Promise.resolve({ token: 'session-token' }),
};

const withSession = ({ children }: { children: ReactNode }) => <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApiClient', () => {
  it('returns the injected client when a provider supplies one', () => {
    const injected = { read: vi.fn(), readAll: vi.fn(), command: vi.fn() } as unknown as ApiClient;
    const { result } = renderHook(() => useApiClient(), {
      wrapper: ({ children }) => (
        <ApiClientProvider client={injected}>{children}</ApiClientProvider>
      ),
    });
    expect(result.current).toBe(injected);
  });

  it('builds a client over the session otherwise: bearer token, language and the contract path', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useApiClient(), { wrapper: withSession });
    await result.current.read('get_resources_role_grant');
    const calls = fetchMock.mock.calls as unknown as Array<[string, { headers: Headers; method: string }]>;
    const [url, init] = calls[0] ?? ['', { headers: new Headers(), method: '' }];
    expect(url).toBe('/resources/role_grant');
    expect(init.method).toBe('GET');
    expect(init.headers.get('authorization')).toBe('Bearer session-token');
    expect(init.headers.get('accept-language')).toBe('vi');
  });

  it('keeps one client between renders of the same session', () => {
    const { result, rerender } = renderHook(() => useApiClient(), { wrapper: withSession });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
