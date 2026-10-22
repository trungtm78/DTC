import { assertAllowedFields } from '../src/allowlist.ts';
import { DomainError } from '../src/errors.ts';

interface PatchBody {
  name: string;
  note: string;
}

function thrownBy(action: () => void): DomainError {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

describe('assertAllowedFields', () => {
  it('accepts a body whose fields are all allowed, including an empty body', () => {
    expect(() => assertAllowedFields<PatchBody>({ name: 'x' }, ['name', 'note'])).not.toThrow();
    expect(() => assertAllowedFields<PatchBody>({}, ['name'])).not.toThrow();
  });

  it('rejects mass-assignment fields with 400 FIELD_NOT_ALLOWED naming them in body order', () => {
    const error = thrownBy(() =>
      assertAllowedFields<PatchBody>({ name: 'x', status: 'ACTIVE', tenant_id: 'other', role: 'admin' }, ['name']),
    );
    expect(error.code).toBe('FIELD_NOT_ALLOWED');
    expect(error.status).toBe(400);
    expect(error.detail).toBe('status, tenant_id, role');
  });

  it('does not echo field values', () => {
    const error = thrownBy(() => assertAllowedFields<PatchBody>({ name: 'x', role: 'secret-value' }, ['name']));
    expect(JSON.stringify(error)).not.toContain('secret-value');
    expect(error.detail).toBe('role');
  });

  it('treats an own __proto__ key from JSON as a disallowed field', () => {
    const body: unknown = JSON.parse('{"name":"x","__proto__":{"isAdmin":true}}');
    expect(thrownBy(() => assertAllowedFields<PatchBody>(body, ['name'])).detail).toBe('__proto__');
  });

  it('does not treat inherited names as allowed (toString is not an allowlisted field)', () => {
    expect(thrownBy(() => assertAllowedFields<PatchBody>({ toString: 'x' }, ['name'])).detail).toBe('toString');
  });

  it.each([null, undefined, 'text', 42, true, ['name']])('rejects the non-object body %p with 422 VALIDATION_FAILED', (body) => {
    const error = thrownBy(() => assertAllowedFields<PatchBody>(body, ['name']));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.status).toBe(422);
  });
});
