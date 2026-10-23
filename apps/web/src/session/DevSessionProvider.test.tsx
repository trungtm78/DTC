import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DEV_SESSION_MARKER, DEV_TENANTS } from './dev-tenants';
import DevSessionProvider from './DevSessionProvider';
import { SessionContext, SIGNED_OUT, useSession } from './SessionContext';

const KEY = Buffer.alloc(32, 9).toString('base64');
const wrapper = ({ children }: { children: ReactNode }) => <DevSessionProvider keyBase64={KEY}>{children}</DevSessionProvider>;

describe('DevSessionProvider', () => {
  it('starts on the first tenant with the development user and offers every tenant', () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.tenant?.id).toBe(DEV_TENANTS[0]?.id);
    expect(result.current.tenants).toHaveLength(2);
    expect(result.current.user?.initials).toBe('AN');
  });

  it('switches tenant and ignores an id that is not one of the memberships', () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    act(() => result.current.switchTenant(DEV_TENANTS[1]?.id ?? ''));
    expect(result.current.tenant?.id).toBe(DEV_TENANTS[1]?.id);
    act(() => result.current.switchTenant('00000000-0000-4000-8000-0000000000ff'));
    expect(result.current.tenant?.id).toBe(DEV_TENANTS[1]?.id);
  });

  it('signs a token for the selected tenant', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    act(() => result.current.switchTenant(DEV_TENANTS[1]?.id ?? ''));
    const session = await result.current.getSession();
    const payload = JSON.parse(Buffer.from((session?.token ?? '').split('.')[0] ?? '', 'base64url').toString('utf8'));
    expect(payload.tenantId).toBe(DEV_TENANTS[1]?.id);
  });

  it('gives no token without a configured key', async () => {
    const { result } = renderHook(() => useSession(), {
      wrapper: ({ children }) => <DevSessionProvider keyBase64="">{children}</DevSessionProvider>,
    });
    expect(await result.current.getSession()).toBeUndefined();
  });

  it('starts at aal1 and reaches aal2 with a timestamp after the step-up', async () => {
    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.assurance).toEqual({ level: 'aal1' });
    await act(async () => {
      await result.current.requestStepUp?.();
    });
    expect(result.current.assurance?.level).toBe('aal2');
    expect(result.current.assurance?.aal2At).toBeInstanceOf(Date);
  });

  it('passes the configured permissions through, and leaves them unknown by default', () => {
    const known = renderHook(() => useSession(), {
      wrapper: ({ children }) => (
        <DevSessionProvider keyBase64={KEY} permissions={['role_grant.read']}>
          {children}
        </DevSessionProvider>
      ),
    });
    expect(known.result.current.permissions).toEqual(['role_grant.read']);
    const unknown = renderHook(() => useSession(), { wrapper });
    expect(unknown.result.current.permissions).toBeUndefined();
  });

  it('marks itself in the page so a production build can be searched for it', () => {
    const { container } = render(
      <DevSessionProvider keyBase64={KEY}>
        <p>child</p>
      </DevSessionProvider>,
    );
    expect(container.querySelector(`[data-dev-session="${DEV_SESSION_MARKER}"]`)).not.toBeNull();
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});

describe('signed-out session', () => {
  it('is what a component sees without a provider', async () => {
    const { result } = renderHook(() => useSession());
    expect(result.current).toBe(SIGNED_OUT);
    expect(result.current.tenant).toBeUndefined();
    expect(await result.current.getSession()).toBeUndefined();
    expect(result.current.switchTenant('x')).toBeUndefined();
    expect(result.current.access.isModuleVisible('PRJ')).toBe(true);
    expect(SessionContext).toBeDefined();
  });
});
