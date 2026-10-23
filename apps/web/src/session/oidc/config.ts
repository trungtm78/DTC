import type { OidcConfig } from './client';

/** Where the provider sends the browser back to with the authorization code. */
export const CALLBACK_PATH = '/auth/callback';
const DEFAULT_CLIENT_ID = 'machvon-web';
const SESSION_MODE_KEY = 'mv.session';

export interface OidcEnvironment {
  VITE_OIDC_ISSUER?: string;
  VITE_OIDC_CLIENT_ID?: string;
  VITE_OIDC_LOGIN_HINT?: string;
}

/** The sign-in configuration of this deployment, or undefined when no identity provider is configured. */
export function oidcConfigFromEnv(env: OidcEnvironment, origin: string): OidcConfig | undefined {
  const issuer = env.VITE_OIDC_ISSUER?.replace(/\/+$/, '');
  if (issuer === undefined || issuer === '') return undefined;
  return {
    issuer,
    clientId: env.VITE_OIDC_CLIENT_ID === undefined || env.VITE_OIDC_CLIENT_ID === '' ? DEFAULT_CLIENT_ID : env.VITE_OIDC_CLIENT_ID,
    redirectUri: `${origin}${CALLBACK_PATH}`,
    ...(env.VITE_OIDC_LOGIN_HINT === undefined || env.VITE_OIDC_LOGIN_HINT === '' ? {} : { loginHint: env.VITE_OIDC_LOGIN_HINT }),
  };
}

/**
 * Development builds only: with an identity provider configured, `?session=oidc` signs in through it instead of the
 * development session, and the choice is kept for the redirect back (the address of the callback carries no query).
 */
export function oidcRequestedInDevelopment(search: string, storage: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage): boolean {
  const asked = new URLSearchParams(search).get('session') === 'oidc';
  try {
    if (asked) {
      storage?.setItem(SESSION_MODE_KEY, 'oidc');
      return true;
    }
    return storage?.getItem(SESSION_MODE_KEY) === 'oidc';
  } catch {
    return asked;
  }
}
