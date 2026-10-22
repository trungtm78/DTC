import { DomainError, parseTenantContext } from '@machvon/kernel';
import type { Plane, TenantContext } from '@machvon/kernel';

/** Request property that the authentication guard fills with the verified Principal. */
export const PRINCIPAL_REQUEST_KEY = 'principal';

const PLANES: readonly Plane[] = ['tenant', 'control', 'internal', 'edge'];
const MAX_SESSION_ID_LENGTH = 128;

/** Who is calling: the tenant context of the token plus the claims the policy decision needs. */
export interface Principal {
  tenant: TenantContext;
  /** The plane the token was issued for (`aud`). */
  audience: Plane;
  assurance: 'aal1' | 'aal2';
  /** When the principal last reached aal2; a step-up command needs it within 15 minutes. */
  aal2At?: Date;
  sessionId: string;
}

function invalidPrincipal(): DomainError {
  return new DomainError('SESSION_EXPIRED', 401);
}

/**
 * Validates what an authentication guard put on the request. A request without a principal, or with one
 * whose claims are malformed, is answered 401 SESSION_EXPIRED; a malformed tenant context is 400
 * TENANT_CONTEXT_INVALID as everywhere else.
 */
export function principalOf(request: { [PRINCIPAL_REQUEST_KEY]?: unknown }): Principal {
  const source = request[PRINCIPAL_REQUEST_KEY];
  if (typeof source !== 'object' || source === null) throw invalidPrincipal();
  const { tenant, audience, assurance, aal2At, sessionId } = source as Record<string, unknown>;
  const context = parseTenantContext(tenant);
  if (!PLANES.includes(audience as Plane)) throw invalidPrincipal();
  if (assurance !== 'aal1' && assurance !== 'aal2') throw invalidPrincipal();
  if (aal2At !== undefined && !(aal2At instanceof Date && !Number.isNaN(aal2At.getTime()))) throw invalidPrincipal();
  if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > MAX_SESSION_ID_LENGTH) throw invalidPrincipal();
  return { tenant: context, audience: audience as Plane, assurance, aal2At: aal2At as Date | undefined, sessionId };
}
