import { describe, expect, it } from 'vitest';
import { CALLBACK_PATH, oidcConfigFromEnv, oidcRequestedInDevelopment } from './config';

const ORIGIN = 'https://app.example';

describe('oidcConfigFromEnv', () => {
  it('builds the configuration from the issuer and the client id, returning to the callback of this origin', () => {
    expect(oidcConfigFromEnv({ VITE_OIDC_ISSUER: 'https://idp.example/realms/m', VITE_OIDC_CLIENT_ID: 'web-client' }, ORIGIN)).toEqual({
      issuer: 'https://idp.example/realms/m',
      clientId: 'web-client',
      redirectUri: `${ORIGIN}${CALLBACK_PATH}`,
    });
  });

  it('defaults the client id and drops a trailing slash of the issuer', () => {
    expect(oidcConfigFromEnv({ VITE_OIDC_ISSUER: 'https://idp.example/realms/m/' }, ORIGIN)).toMatchObject({ issuer: 'https://idp.example/realms/m', clientId: 'machvon-web' });
  });

  it('adds the login hint of a development provider that picks the user from it', () => {
    expect(oidcConfigFromEnv({ VITE_OIDC_ISSUER: 'https://idp.example/r', VITE_OIDC_LOGIN_HINT: 'owner' }, ORIGIN)).toMatchObject({ loginHint: 'owner' });
  });

  it.each([[{}], [{ VITE_OIDC_ISSUER: '' }], [{ VITE_OIDC_ISSUER: undefined }]])('is undefined without an issuer (%j)', (env) => {
    expect(oidcConfigFromEnv(env, ORIGIN)).toBeUndefined();
  });
});

describe('oidcRequestedInDevelopment', () => {
  function storage(initial: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(initial));
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) } as unknown as Storage;
  }

  it('is true for ?session=oidc and remembers it for the redirect back from the provider', () => {
    const memory = storage();
    expect(oidcRequestedInDevelopment('?session=oidc', memory)).toBe(true);
    expect(oidcRequestedInDevelopment('', memory)).toBe(true);
  });

  it('is false by default and for any other value', () => {
    expect(oidcRequestedInDevelopment('', storage())).toBe(false);
    expect(oidcRequestedInDevelopment('?session=dev', storage())).toBe(false);
  });

  it('works when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(oidcRequestedInDevelopment('?session=oidc', blocked)).toBe(true);
    expect(oidcRequestedInDevelopment('', blocked)).toBe(false);
  });
});
