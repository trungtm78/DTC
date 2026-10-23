import type { JsonWebKey } from 'node:crypto';
/** Where a verifier gets the published public keys of the identity provider. */
export interface JwksSource {
  /** The key with this id, or undefined when the provider does not publish it; throws when keys cannot be trusted at all. */
  keyFor(keyId: string): Promise<JsonWebKey | undefined>;
}

export interface HttpJwksSourceOptions {
  jwksUri: string;
  fetch?: typeof fetch;
  /** How long a fetched key set stays trusted; after that it is refreshed and, if that fails, refused. Default 300 s. */
  maxAgeSeconds?: number;
  /** The shortest time between two fetches caused by unknown key ids. Default 10 s. */
  minRefetchSeconds?: number;
  timeoutMs?: number;
  now?: () => Date;
}

const DEFAULT_MAX_AGE_SECONDS = 300;
const DEFAULT_MIN_REFETCH_SECONDS = 10;
const DEFAULT_TIMEOUT_MS = 3000;

interface KeySet {
  keys: Map<string, JsonWebKey>;
  fetchedAt: number;
}

function isJwk(value: unknown): value is JsonWebKey & { kid: string } {
  return typeof value === 'object' && value !== null && typeof (value as { kid?: unknown }).kid === 'string';
}

/**
 * Fetches a JWKS over HTTP, caches it, refreshes it when it gets old or when an unknown key id shows up (at most
 * once per `minRefetchSeconds`), and fails closed: a key set older than its maximum age is never used when the
 * refresh fails.
 */
export class HttpJwksSource implements JwksSource {
  private readonly fetcher: typeof fetch;
  private readonly maxAgeMs: number;
  private readonly minRefetchMs: number;
  private readonly timeoutMs: number;
  private readonly clock: () => Date;
  private cache: KeySet | undefined;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<KeySet> | undefined;
  private lastFailed = false;

  constructor(private readonly options: HttpJwksSourceOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.maxAgeMs = (options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS) * 1000;
    this.minRefetchMs = (options.minRefetchSeconds ?? DEFAULT_MIN_REFETCH_SECONDS) * 1000;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.clock = options.now ?? (() => new Date());
  }

  async keyFor(keyId: string): Promise<JsonWebKey | undefined> {
    const now = this.clock().getTime();
    const cached = this.cache;
    if (cached === undefined || now - cached.fetchedAt > this.maxAgeMs) {
      // A stale or missing set must be refreshed; if that fails the error stands and nothing old is used.
      return (await this.refresh(now, true)).keys.get(keyId);
    }
    const known = cached.keys.get(keyId);
    // An unknown key id: the provider may have rotated. One refresh, and not more often than the minimum gap.
    if (known !== undefined || now - this.lastAttemptAt < this.minRefetchMs) return known;
    try {
      return (await this.refresh(now, false)).keys.get(keyId);
    } catch {
      return undefined;
    }
  }

  private refresh(now: number, force: boolean): Promise<KeySet> {
    if (this.inFlight !== undefined) return this.inFlight;
    if (this.lastFailed && now - this.lastAttemptAt < this.minRefetchMs) {
      // The provider just failed: do not hammer it with one request per token.
      return Promise.reject(new Error('JWKS unavailable'));
    }
    if (!force && this.cache !== undefined && now - this.lastAttemptAt < this.minRefetchMs) return Promise.resolve(this.cache);
    this.lastAttemptAt = now;
    const attempt = this.download(now)
      .then((keys) => {
        this.lastFailed = false;
        return keys;
      })
      .catch((error: unknown) => {
        this.lastFailed = true;
        throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    this.inFlight = attempt;
    return attempt;
  }

  private async download(now: number): Promise<KeySet> {
    const response = await this.fetcher(this.options.jwksUri, { signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`JWKS answered ${response.status}`);
    const body: unknown = await response.json();
    const list = typeof body === 'object' && body !== null ? (body as { keys?: unknown }).keys : undefined;
    if (!Array.isArray(list)) throw new Error('JWKS has no key list');
    const keys = new Map<string, JsonWebKey>();
    for (const item of list) if (isJwk(item)) keys.set(item.kid, item);
    this.cache = { keys, fetchedAt: now };
    return this.cache;
  }
}

/** Reads the JWKS address from the OIDC discovery document of an issuer and checks that it names the same issuer. */
export async function discoverJwksUri(issuer: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`discovery answered ${response.status}`);
  const document = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };
  if (document.issuer !== issuer) throw new Error('discovery document names another issuer');
  if (typeof document.jwks_uri !== 'string' || document.jwks_uri === '') throw new Error('discovery document has no jwks_uri');
  return document.jwks_uri;
}
