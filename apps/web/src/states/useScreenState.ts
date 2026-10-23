import { ApiError, NETWORK_ERROR_CODE } from '@machvon/api-client';
import type { ScreenState } from './StateBoundary';

const SESSION_EXPIRED = 'SESSION_EXPIRED';
const FORBIDDEN = 403;

export interface ScreenQuery {
  isLoading: boolean;
  error?: unknown;
  data?: unknown;
  /** What "no data" means for this screen; the default treats an empty list or an empty page as empty. */
  isEmpty?: (data: unknown) => boolean;
}

function isEmptyByDefault(data: unknown): boolean {
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object' && data !== null && 'items' in data) {
    const { items } = data as { items: unknown };
    return Array.isArray(items) && items.length === 0;
  }
  return false;
}

/**
 * Maps a query result to one of the seven UI states: a lapsed session is `signedOut`, a refusal for scope or
 * entitlement is `denied`, a failed network is `offline`, any other failure is `error`, and an empty page is `empty`.
 */
export function useScreenState(query: ScreenQuery): ScreenState {
  if (query.error !== undefined && query.error !== null) {
    if (query.error instanceof ApiError) {
      if (query.error.code === SESSION_EXPIRED) return 'signedOut';
      if (query.error.status === FORBIDDEN) return 'denied';
      if (query.error.code === NETWORK_ERROR_CODE) return 'offline';
    }
    return 'error';
  }
  if (query.isLoading) return 'loading';
  if (query.data === undefined) return 'default';
  return (query.isEmpty ?? isEmptyByDefault)(query.data) ? 'empty' : 'default';
}
