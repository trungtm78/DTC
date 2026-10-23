import { isIP } from 'node:net';
import { DomainError } from './errors.ts';

/** The content of a security policy version (ADM-14, `SecurityPolicyDraft` in openapi.json). */
export interface SecurityPolicyContent {
  /** Roles that need a second factor at sign-in in this tenant. */
  mfa_required_roles: readonly string[];
  session_idle_minutes: number;
  session_max_hours: number;
  /** Addresses or CIDR ranges that may sign in; empty or absent means no restriction. */
  ip_allowlist?: readonly string[];
  download_ttl_minutes?: number;
  export_watermark?: boolean;
}

const MAX_ALLOWLIST_ENTRIES = 200;
const MINUTES_PER_HOUR = 60;
const PREFIX = /^(0|[1-9][0-9]{0,2})$/;

function invalid(field: string): DomainError {
  // The detail names the field; a value is never echoed (a role name or an address can be sensitive).
  return new DomainError('POLICY_INVALID', 422, field);
}

function validAddress(entry: string): boolean {
  const [address = '', prefix, ...rest] = entry.split('/');
  if (rest.length > 0) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  return PREFIX.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Rules of a security policy that the request schema cannot state (BR-IAM-11, ADM 3.10): every role exists in the
 * tenant and is listed once, an idle limit is never longer than the session itself, and every allowlist entry is a
 * valid address or range, listed once. Fails with 422 POLICY_INVALID naming the first offending field.
 */
export function validateSecurityPolicy(content: SecurityPolicyContent, knownRoleCodes: ReadonlySet<string>): void {
  const roles = content.mfa_required_roles;
  if (new Set(roles).size !== roles.length || roles.some((role) => !knownRoleCodes.has(role))) throw invalid('mfa_required_roles');
  if (content.session_idle_minutes > content.session_max_hours * MINUTES_PER_HOUR) throw invalid('session_idle_minutes');
  const allowlist = content.ip_allowlist ?? [];
  if (allowlist.length > MAX_ALLOWLIST_ENTRIES || new Set(allowlist).size !== allowlist.length || !allowlist.every(validAddress)) throw invalid('ip_allowlist');
}
