import { createHmac } from 'node:crypto';
import { DomainError } from '../src/errors.ts';
import { signTenantContext, verifyTenantContext } from '../src/signed-context.ts';
import type { TenantContext } from '../src/tenant-context.ts';

const TENANT = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTHER_TENANT = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const MEMBERSHIP = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const NOW = 1_800_000_000;

const ctx: TenantContext = { tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: 4 };

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(payloadPart: string, key: Buffer = KEY): string {
  return createHmac('sha256', key).update(payloadPart).digest('base64url');
}

function forge(payload: unknown, key: Buffer = KEY): string {
  const part = encode(payload);
  return `${part}.${sign(part, key)}`;
}

function thrownBy(token: string, key: Buffer = KEY, now: () => number = () => NOW): DomainError {
  try {
    verifyTenantContext(token, key, now);
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('verifyTenantContext did not throw');
}

function expectInvalid(token: string, key: Buffer = KEY, now: () => number = () => NOW): void {
  const error = thrownBy(token, key, now);
  expect(error.code).toBe('TENANT_CONTEXT_INVALID');
  expect(error.status).toBe(400);
}

describe('signTenantContext', () => {
  it('produces a compact payload.signature token with the documented payload', () => {
    const token = signTenantContext(ctx, KEY, () => NOW);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(JSON.parse(Buffer.from(parts[0] ?? '', 'base64url').toString('utf8'))).toEqual({
      tenantId: TENANT,
      membershipId: MEMBERSHIP,
      scopeVersion: 4,
      exp: NOW + 300,
    });
    expect(parts[1]).toBe(sign(parts[0] ?? ''));
  });

  it('honours a custom ttl', () => {
    const token = signTenantContext(ctx, KEY, () => NOW, 60);
    const payload = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'));
    expect(payload.exp).toBe(NOW + 60);
  });

  it('defaults now to the current wall clock in whole seconds', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signTenantContext(ctx, KEY);
    const after = Math.floor(Date.now() / 1000);
    const payload = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'));
    expect(Number.isInteger(payload.exp)).toBe(true);
    expect(payload.exp).toBeGreaterThanOrEqual(before + 300);
    expect(payload.exp).toBeLessThanOrEqual(after + 300);
  });

  it('rejects keys shorter than 32 bytes with a plain Error', () => {
    expect(() => signTenantContext(ctx, Buffer.alloc(31, 1), () => NOW)).toThrow('key too short');
    try {
      signTenantContext(ctx, Buffer.alloc(31, 1), () => NOW);
    } catch (error) {
      expect(error).not.toBeInstanceOf(DomainError);
    }
  });

  it('does not sign input that is not a valid tenant context', () => {
    const bad = { tenantId: 'nope', membershipId: MEMBERSHIP, scopeVersion: 1 };
    expect(() => signTenantContext(bad, KEY, () => NOW)).toThrow(DomainError);
  });
});

describe('verifyTenantContext', () => {
  it('round trips the same context', () => {
    const token = signTenantContext(ctx, KEY, () => NOW);
    expect(verifyTenantContext(token, KEY, () => NOW + 10)).toEqual(ctx);
  });

  it('verifies with the default clock for a fresh token', () => {
    expect(verifyTenantContext(signTenantContext(ctx, KEY), KEY)).toEqual(ctx);
  });

  it('rejects a payload whose tenantId was changed while keeping the signature (AC-ST-IAM-001-4)', () => {
    const token = signTenantContext(ctx, KEY, () => NOW);
    const [payloadPart, signaturePart] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadPart ?? '', 'base64url').toString('utf8'));
    const tampered = `${encode({ ...payload, tenantId: OTHER_TENANT })}.${signaturePart}`;
    expectInvalid(tampered);
  });

  it('rejects an expired token and a token expiring exactly now', () => {
    const token = signTenantContext(ctx, KEY, () => NOW, 300);
    expectInvalid(token, KEY, () => NOW + 301);
    expectInvalid(token, KEY, () => NOW + 300);
    expect(verifyTenantContext(token, KEY, () => NOW + 299)).toEqual(ctx);
  });

  it('rejects a token signed with another key', () => {
    expectInvalid(signTenantContext(ctx, OTHER_KEY, () => NOW));
  });

  it('rejects structurally malformed tokens', () => {
    expectInvalid('');
    expectInvalid('onlyonepart');
    expectInvalid('a.b.c');
    expectInvalid('.');
    expectInvalid('.abc');
    expectInvalid('abc.');
  });

  it('rejects a signature of the wrong length', () => {
    const part = encode({ ...ctx, exp: NOW + 100 });
    expectInvalid(`${part}.${sign(part).slice(0, -2)}`);
    expectInvalid(`${part}.${sign(part)}AA`);
  });

  it('rejects a correctly signed payload that is not JSON', () => {
    const part = Buffer.from('not json', 'utf8').toString('base64url');
    expectInvalid(`${part}.${sign(part)}`);
  });

  it('rejects a correctly signed payload that is not an object', () => {
    expectInvalid(forge('text'));
    expectInvalid(forge(null));
    expectInvalid(forge([1, 2]));
  });

  it('rejects a correctly signed payload with an invalid context shape', () => {
    expectInvalid(forge({ tenantId: 'nope', membershipId: MEMBERSHIP, scopeVersion: 1, exp: NOW + 100 }));
    expectInvalid(forge({ tenantId: TENANT, membershipId: MEMBERSHIP, scopeVersion: -1, exp: NOW + 100 }));
  });

  it('rejects a correctly signed payload with a missing or non-numeric exp', () => {
    expectInvalid(forge({ ...ctx }));
    expectInvalid(forge({ ...ctx, exp: String(NOW + 100) }));
    expectInvalid(forge({ ...ctx, exp: null }));
  });

  it('never echoes token contents in the error', () => {
    const token = signTenantContext(ctx, OTHER_KEY, () => NOW);
    const error = thrownBy(token);
    const text = `${error.message} ${error.detail ?? ''}`;
    expect(text).not.toContain(token);
    expect(text).not.toContain(TENANT);
    expect(text).not.toContain(token.split('.')[0] ?? 'x');
  });

  it('rejects keys shorter than 32 bytes with a plain Error', () => {
    const token = signTenantContext(ctx, KEY, () => NOW);
    expect(() => verifyTenantContext(token, Buffer.alloc(8, 1), () => NOW)).toThrow('key too short');
  });
});
