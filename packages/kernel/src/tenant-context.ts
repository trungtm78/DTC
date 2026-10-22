import { DomainError } from './errors.ts';

export interface TenantContext {
  tenantId: string;
  membershipId: string;
  scopeVersion: number;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | undefined {
  return typeof value === 'string' && CANONICAL_UUID.test(value) ? value.toLowerCase() : undefined;
}

function asScopeVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Validates untrusted input into a TenantContext. Only the three known fields
 * are read; unknown fields are never copied. On failure the DomainError names
 * the invalid fields and never echoes their values.
 */
export function parseTenantContext(input: unknown): TenantContext {
  const source: Record<string, unknown> =
    typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

  const tenantId = asUuid(source.tenantId);
  const membershipId = asUuid(source.membershipId);
  const scopeVersion = asScopeVersion(source.scopeVersion);

  if (tenantId === undefined || membershipId === undefined || scopeVersion === undefined) {
    const invalid: string[] = [];
    if (tenantId === undefined) invalid.push('tenantId');
    if (membershipId === undefined) invalid.push('membershipId');
    if (scopeVersion === undefined) invalid.push('scopeVersion');
    throw new DomainError('TENANT_CONTEXT_INVALID', 400, invalid.join(', '));
  }

  return { tenantId, membershipId, scopeVersion };
}
