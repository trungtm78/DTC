import { safeDiff } from '../src/redact.ts';

const REDACTED = '[REDACTED]';

describe('safeDiff', () => {
  it('redacts sensitive keys at every depth, including inside arrays', () => {
    const input = {
      name: 'Đà Nẵng',
      password: 'p',
      nested: { apiKey: 'k', API_KEY: 'k2', note: 'ok', deeper: { Authorization: 'Bearer x', private_key: 'pk' } },
      list: [{ client_secret: 's', id: 1 }, 'plain', { refreshToken: 't' }],
    };
    expect(safeDiff(input)).toEqual({
      name: 'Đà Nẵng',
      password: REDACTED,
      nested: { apiKey: REDACTED, API_KEY: REDACTED, note: 'ok', deeper: { Authorization: REDACTED, private_key: REDACTED } },
      list: [{ client_secret: REDACTED, id: 1 }, 'plain', { refreshToken: REDACTED }],
    });
  });

  it('redacts caller-declared sensitive keys exactly', () => {
    expect(safeDiff({ contract_value: 10, contract_name: 'a' }, { sensitiveKeys: ['contract_value'] })).toEqual({
      contract_value: REDACTED,
      contract_name: 'a',
    });
  });

  it('does not mutate its input and leaves non-sensitive values untouched', () => {
    const input = { password: 'p', count: 3, when: null, flag: false };
    const copy = JSON.parse(JSON.stringify(input)) as typeof input;
    expect(safeDiff(input)).toEqual({ password: REDACTED, count: 3, when: null, flag: false });
    expect(input).toEqual(copy);
  });

  it('redacts a whole sensitive subtree', () => {
    expect(safeDiff({ token: { value: 'x', exp: 1 } })).toEqual({ token: REDACTED });
  });
});
