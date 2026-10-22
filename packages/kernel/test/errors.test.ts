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

  it('carries optional extensions and headers', () => {
    const error = new DomainError('VERSION_CONFLICT', 409, undefined, {
      extensions: { current_version: 8 },
      headers: { 'Retry-After': '2' },
    });
    expect(error.extensions).toEqual({ current_version: 8 });
    expect(error.headers).toEqual({ 'Retry-After': '2' });
  });

  it('leaves extensions and headers undefined when omitted', () => {
    const error = new DomainError('VERSION_CONFLICT', 409);
    expect(error.extensions).toBeUndefined();
    expect(error.headers).toBeUndefined();
  });
});
