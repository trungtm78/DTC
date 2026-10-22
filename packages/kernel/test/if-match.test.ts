import { DomainError } from '../src/errors.ts';
import { formatEtag, parseIfMatch, versionConflict } from '../src/if-match.ts';

function rejection(run: () => unknown): DomainError {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
}

describe('parseIfMatch', () => {
  it.each(['"7"', 'W/"7"', '7', ' "7" '])('parses %s to 7', (header) => {
    expect(parseIfMatch(header)).toBe(7);
  });

  it('parses zero', () => {
    expect(parseIfMatch('"0"')).toBe(0);
  });

  it('answers 428 PRECONDITION_REQUIRED when the header is absent', () => {
    const error = rejection(() => parseIfMatch(undefined));
    expect(error.code).toBe('PRECONDITION_REQUIRED');
    expect(error.status).toBe(428);
  });

  it.each(['abc', '-1', '7.5', '9007199254740993', '', '"7', '*', '1e3'])('rejects %p with 400 INVALID_REQUEST', (header) => {
    const error = rejection(() => parseIfMatch(header));
    expect(error.code).toBe('INVALID_REQUEST');
    expect(error.status).toBe(400);
    expect(error.detail).toBe('if_match');
  });

  it('rejects a repeated header', () => {
    expect(rejection(() => parseIfMatch(['"7"', '"8"'])).code).toBe('INVALID_REQUEST');
  });
});

describe('formatEtag and versionConflict', () => {
  it('quotes the version', () => {
    expect(formatEtag(7)).toBe('"7"');
  });

  it('refuses a version that is not a non-negative safe integer', () => {
    expect(() => formatEtag(-1)).toThrow(RangeError);
    expect(() => formatEtag(1.5)).toThrow(RangeError);
  });

  it('builds a 409 VERSION_CONFLICT carrying current_version and an optional safe diff', () => {
    const plain = versionConflict(8);
    expect(plain.code).toBe('VERSION_CONFLICT');
    expect(plain.status).toBe(409);
    expect(plain.extensions).toEqual({ current_version: 8 });
    const withDiff = versionConflict(8, { name: 'x' });
    expect(withDiff.extensions).toEqual({ current_version: 8, safe_diff: { name: 'x' } });
  });
});
