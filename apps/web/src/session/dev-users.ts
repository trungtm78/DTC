import { DEV_USER } from './dev-tenants';
import type { SessionTenant, SessionUser } from './SessionContext';

/** A user of the development API fixture: `?devUser=<key>` signs requests as this membership. */
export interface DevUserFixture {
  key: string;
  displayName: string;
  /** Letters in the round user mark; derived from the name when absent. */
  initials?: string;
  membershipId: string;
  /** Permissions the screens treat as held (read-only modes); null leaves them unknown, so every control shows. */
  permissions: readonly string[] | null;
}

function isFixture(value: unknown): value is DevUserFixture {
  if (typeof value !== 'object' || value === null) return false;
  const { key, displayName, initials, membershipId, permissions } = value as Record<string, unknown>;
  const listed = permissions === null || (Array.isArray(permissions) && permissions.every((item) => typeof item === 'string'));
  const marked = initials === undefined || typeof initials === 'string';
  return typeof key === 'string' && typeof displayName === 'string' && typeof membershipId === 'string' && listed && marked;
}

/** Reads the fixture users from the text of `VITE_DEV_USERS` (a JSON array); anything unusable gives no users. */
export function parseDevUsers(text: string | undefined): readonly DevUserFixture[] {
  if (text === undefined || text === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return Array.isArray(parsed) && parsed.every(isFixture) ? parsed : [];
}

/** The fixture user named by `?devUser=` in an address query. */
export function devUserFor(search: string, users: readonly DevUserFixture[]): DevUserFixture | undefined {
  const key = new URLSearchParams(search).get('devUser');
  return key === null ? undefined : users.find((user) => user.key === key);
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

/** The session pieces a picked fixture user changes: its membership in every tenant, its name and its permissions. */
export function applyDevUser(
  picked: DevUserFixture | undefined,
  tenants: readonly SessionTenant[],
): { user: SessionUser; tenants: readonly SessionTenant[]; permissions: readonly string[] | undefined } {
  if (picked === undefined) return { user: DEV_USER, tenants, permissions: undefined };
  return {
    user: { ...DEV_USER, displayName: picked.displayName, initials: picked.initials ?? initialsOf(picked.displayName) },
    tenants: tenants.map((tenant) => ({ ...tenant, membershipId: picked.membershipId })),
    permissions: picked.permissions ?? undefined,
  };
}
