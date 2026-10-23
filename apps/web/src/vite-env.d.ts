/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base64 of at least 32 bytes shared with the development API (development builds only). */
  readonly VITE_DEV_SESSION_KEY?: string;
  /** JSON array of the development API's fixture users, see session/dev-users.ts (development builds only). */
  readonly VITE_DEV_USERS?: string;
  /** Origin of the API; the same origin when unset. */
  readonly VITE_API_BASE_URL?: string;
}
