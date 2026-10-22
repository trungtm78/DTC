import { DomainError } from '../src/errors.ts';

describe('DomainError', () => {
  it('carries code, status and detail and is an Error', () => {
    const error = new DomainError('SCOPE_DENIED', 403, 'unit');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe('DomainError');
    expect(error.code).toBe('SCOPE_DENIED');
    expect(error.status).toBe(403);
    expect(error.detail).toBe('unit');
    expect(error.message).toBe('SCOPE_DENIED');
  });

  it('leaves detail undefined when omitted', () => {
    expect(new DomainError('VERSION_CONFLICT', 409).detail).toBeUndefined();
  });
});
