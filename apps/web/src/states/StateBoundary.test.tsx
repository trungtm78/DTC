import { ApiError } from '@machvon/api-client';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import vi_ from '../i18n/vi.json';
import { StateBoundary } from './StateBoundary';
import type { ScreenState } from './StateBoundary';
import { useScreenState } from './useScreenState';

const problem = (status: number, code: string): ApiError =>
  new ApiError({ status, code, correlationId: '00000000-0000-4000-8000-000000000001' });

describe('StateBoundary', () => {
  it('renders the children only for the default state', () => {
    render(
      <StateBoundary state="default">
        <p>content</p>
      </StateBoundary>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a busy status with skeleton rows while loading, and never the children', () => {
    render(
      <StateBoundary state="loading">
        <p>content</p>
      </StateBoundary>,
    );
    const status = screen.getByRole('status', { name: vi_['states.loading.label'] });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status.querySelectorAll('.skeleton')).toHaveLength(7);
    expect(screen.queryByText('content')).toBeNull();
  });

  it.each([
    ['empty', 'status'],
    ['error', 'alert'],
    ['denied', 'alert'],
    ['expired', 'alert'],
    ['offline', 'status'],
  ] as const)('renders the %s state with its title, body and the %s role', (state: Exclude<ScreenState, 'default' | 'loading'>, role) => {
    render(
      <StateBoundary state={state}>
        <p>content</p>
      </StateBoundary>,
    );
    const region = screen.getByRole(role);
    expect(region).toHaveClass('statecard');
    expect(screen.getByRole('heading', { level: 1, name: vi_[`states.${state}.title`] })).toBeInTheDocument();
    expect(screen.getByText(vi_[`states.${state}.body`])).toBeInTheDocument();
    expect(screen.queryByText('content')).toBeNull();
  });

  it('calls onRetry from the retry button and omits the button without a handler', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<StateBoundary state="error" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: vi_['states.retry.action'] }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<StateBoundary state="error" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('useScreenState', () => {
  const state = (query: Parameters<typeof useScreenState>[0]) => renderHook(() => useScreenState(query)).result.current;

  it('maps loading, success and an empty page', () => {
    expect(state({ isLoading: true })).toBe('loading');
    expect(state({ isLoading: false, data: { items: [{ id: 1 }] } })).toBe('default');
    expect(state({ isLoading: false, data: { items: [], next_cursor: null } })).toBe('empty');
    expect(state({ isLoading: false, data: [] })).toBe('empty');
    expect(state({ isLoading: false, data: undefined })).toBe('default');
    expect(state({ isLoading: false, data: { value: 1 } })).toBe('default');
  });

  it('maps API errors: session, scope, network and anything else', () => {
    expect(state({ isLoading: false, error: problem(401, 'SESSION_EXPIRED') })).toBe('expired');
    expect(state({ isLoading: false, error: problem(403, 'SCOPE_DENIED') })).toBe('denied');
    expect(state({ isLoading: false, error: problem(403, 'ENTITLEMENT_DENIED') })).toBe('denied');
    expect(state({ isLoading: false, error: problem(0, 'NETWORK_ERROR') })).toBe('offline');
    expect(state({ isLoading: false, error: problem(500, 'INTERNAL_ERROR') })).toBe('error');
    expect(state({ isLoading: false, error: new Error('boom') })).toBe('error');
  });

  it('lets the caller decide what empty means', () => {
    expect(state({ isLoading: false, data: { total: 0 }, isEmpty: (data) => (data as { total: number }).total === 0 })).toBe('empty');
  });

  it('prefers an error over stale data', () => {
    expect(state({ isLoading: false, data: { items: [{ id: 1 }] }, error: problem(500, 'INTERNAL_ERROR') })).toBe('error');
  });
});
