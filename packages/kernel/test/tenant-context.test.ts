import { DomainError } from '../src/errors.ts';
import { parseTenantContext } from '../src/tenant-context.ts';

const TENANT = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const MEMBERSHIP = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: 3, ...overrides };
}

function thrownBy(input: unknown): DomainError {
  try {
    parseTenantContext(input);
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('parseTenantContext did not throw');
}

describe('parseTenantContext', () => {
  it('returns the context for valid input', () => {
    expect(parseTenantContext(valid())).toEqual({ tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: 3 });
  });

  it('normalises uppercase UUIDs to lowercase', () => {
    const ctx = parseTenantContext(valid({ tenantId: TENANT.toUpperCase(), membershipId: MEMBERSHIP.toUpperCase() }));
    expect(ctx.tenantId).toBe(TENANT);
    expect(ctx.membershipId).toBe(MEMBERSHIP);
  });

  it('accepts scopeVersion zero', () => {
    expect(parseTenantContext(valid({ scopeVersion: 0 })).scopeVersion).toBe(0);
  });

  it('ignores and does not copy unknown fields', () => {
    const ctx = parseTenantContext(valid({ role: 'ADMIN', tenant_id: 'x' }));
    expect(Object.keys(ctx).sort()).toEqual(['membershipId', 'scopeVersion', 'tenantId']);
  });

  it.each([
    ['empty string', ''],
    ['40 character string', 'a'.repeat(40)],
    ['SQL injection text', "'; drop table x;--"],
    ['UUID without hyphens', TENANT.replaceAll('-', '')],
    ['UUID with a trailing newline', `${TENANT}\n`],
    ['UUID with surrounding spaces', ` ${TENANT} `],
    ['UUID with non-hex characters', 'zf2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'],
    ['braced UUID', `{${TENANT}}`],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
    ['array', [TENANT]],
  ])('rejects tenantId that is %s with TENANT_CONTEXT_INVALID naming only the field', (_label, value) => {
    const error = thrownBy(valid({ tenantId: value }));
    expect(error.code).toBe('TENANT_CONTEXT_INVALID');
    expect(error.status).toBe(400);
    expect(error.detail).toBe('tenantId');
  });

  it('rejects an invalid membershipId and names it', () => {
    const error = thrownBy(valid({ membershipId: 'nope' }));
    expect(error.code).toBe('TENANT_CONTEXT_INVALID');
    expect(error.detail).toBe('membershipId');
  });

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['string', '3'],
    ['null', null],
    ['undefined', undefined],
  ])('rejects scopeVersion that is %s', (_label, value) => {
    const error = thrownBy(valid({ scopeVersion: value }));
    expect(error.code).toBe('TENANT_CONTEXT_INVALID');
    expect(error.status).toBe(400);
    expect(error.detail).toBe('scopeVersion');
  });

  it('names every invalid field together in a stable order', () => {
    const error = thrownBy({ tenantId: '', membershipId: 7, scopeVersion: -1 });
    expect(error.detail).toBe('tenantId, membershipId, scopeVersion');
  });

  it('never leaks offending values in the error', () => {
    const error = thrownBy(valid({ tenantId: "'; drop table x;--" }));
    expect(JSON.stringify([error.message, error.detail, error.code])).not.toContain('drop table');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', TENANT],
    ['a number', 1],
    ['an array', []],
  ])('rejects %s input as a whole', (_label, input) => {
    const error = thrownBy(input);
    expect(error.code).toBe('TENANT_CONTEXT_INVALID');
    expect(error.status).toBe(400);
    expect(error.detail).toBe('tenantId, membershipId, scopeVersion');
  });
});
