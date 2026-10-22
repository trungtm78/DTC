import { effectivePermissions, holdsPermission } from './effective-access.ts';
import type { EffectiveAccess } from './effective-access.ts';
import type { ResourceRef } from './scope.ts';

export type Plane = 'tenant' | 'control' | 'internal' | 'edge';

export interface DecideInput {
  required: { permission: string; plane: Plane; stepUp?: 'aal2' };
  principal: {
    audience: Plane;
    assurance: 'aal1' | 'aal2';
    /** When the principal last reached aal2; step-up needs it within 15 minutes. */
    aal2At?: Date;
    sessionRevoked: boolean;
    tokenScopeVersion: number;
  };
  access: EffectiveAccess;
  resource?: ResourceRef;
  now: Date;
  entitled?: (permission: string) => boolean;
}

export type Decision =
  | { allow: true }
  | {
      allow: false;
      reason: 'PLANE' | 'SESSION_REVOKED' | 'STALE_SCOPE_VERSION' | 'NO_PERMISSION' | 'ENTITLEMENT' | 'STEP_UP';
      code: 'SCOPE_DENIED' | 'SESSION_EXPIRED' | 'ENTITLEMENT_DENIED' | 'MFA_REQUIRED';
      status: 401 | 403;
    };

export const STEP_UP_WINDOW_MINUTES = 15;

const deny = (reason: 'PLANE' | 'STALE_SCOPE_VERSION' | 'NO_PERMISSION', code: 'SCOPE_DENIED'): Decision => ({ allow: false, reason, code, status: 403 });

/**
 * The policy decision of IAM 3.4 in its fixed order: plane, session deny-list, permission on the scope that contains
 * the resource (computed from `access`, which carries the database `scope_version`, so a token with an older version
 * never widens access), entitlement, step-up. When the token is older than the database and the permission is gone,
 * the reason is STALE_SCOPE_VERSION; the answer is the same 403 SCOPE_DENIED.
 */
export function decide(input: DecideInput): Decision {
  const { required, principal, access, resource, now } = input;
  if (principal.audience !== required.plane) return deny('PLANE', 'SCOPE_DENIED');
  if (principal.sessionRevoked) return { allow: false, reason: 'SESSION_REVOKED', code: 'SESSION_EXPIRED', status: 401 };
  if (!holdsPermission(effectivePermissions(access, now, resource), required.permission)) {
    return deny(principal.tokenScopeVersion < access.scopeVersion ? 'STALE_SCOPE_VERSION' : 'NO_PERMISSION', 'SCOPE_DENIED');
  }
  if (input.entitled !== undefined && !input.entitled(required.permission)) {
    return { allow: false, reason: 'ENTITLEMENT', code: 'ENTITLEMENT_DENIED', status: 403 };
  }
  if (required.stepUp === 'aal2') {
    const fresh =
      principal.assurance === 'aal2' &&
      principal.aal2At !== undefined &&
      now.getTime() - principal.aal2At.getTime() <= STEP_UP_WINDOW_MINUTES * 60_000;
    if (!fresh) return { allow: false, reason: 'STEP_UP', code: 'MFA_REQUIRED', status: 403 };
  }
  return { allow: true };
}
