import { randomUUID } from 'node:crypto';
import { DomainError } from '@machvon/kernel';
import { signDigest } from './mock-pki.ts';
import type { Identity, TimestampSource } from './mock-pki.ts';

/** How a signature is obtained: a certification authority's remote service, an agent on the signer's machine, or the mock. */
export type SigningProvider = 'REMOTE_CA' | 'LOCAL_AGENT' | 'MOCK';

/** What the provider receives (BR-DOC-14 b): the digest of the byte range, never the document. */
export interface SigningRequest {
  /** SHA-256 of the covered bytes: exactly 64 hexadecimal characters. */
  digestSha256: string;
  /** SHA-256 fingerprint of the registered signing certificate the signature must be made with. */
  certificateFingerprint: string;
  correlationId: string;
}

export interface SessionRef {
  provider: SigningProvider;
  sessionId: string;
  expiresAt: Date;
}

/** What comes back: a detached CMS (DER ContentInfo), PAdES-B-B or B-T. Key material never crosses the port. */
export interface SignedPayload {
  cms: Uint8Array;
}

export interface SigningPort {
  readonly provider: SigningProvider;
  /** Opens a signing session for one digest. Fails with PROVIDER_UNAVAILABLE (503) when the provider cannot be reached. */
  startSession(request: SigningRequest): Promise<SessionRef>;
  /**
   * 'PENDING' until the signer has approved; then the payload, the same one on every later call. Fails with
   * SIGNING_SESSION_EXPIRED (409) for an expired or cancelled session and RESOURCE_NOT_FOUND (404) for an unknown one.
   */
  collect(ref: SessionRef): Promise<SignedPayload | 'PENDING'>;
  /** Cancels the session; cancelling twice is not an error. */
  cancel(ref: SessionRef): Promise<void>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
export const SIGNING_SESSION_TTL_MS = 15 * 60 * 1000;

interface MockSession {
  request: SigningRequest;
  expiresAt: Date;
  approved: boolean;
  cancelled: boolean;
  payload: SignedPayload | null;
}

export interface MockSigningOptions {
  /** The certificate and key the mock signs with; the key stays inside the mock. */
  identity: Identity;
  clock: () => Date;
  /** Adds an RFC 3161 signature timestamp, so the signature reaches PAdES-B-T. */
  timestamps?: TimestampSource;
  ttlMs?: number;
}

/**
 * The MOCK adapter: it signs the digest with a test identity once `approve` has been called, the way a signer
 * confirming on their device would. It is the stand-in until a certification authority sandbox exists.
 */
export class MockSigningPort implements SigningPort {
  readonly provider = 'MOCK' as const;
  private readonly sessions = new Map<string, MockSession>();
  private available = true;

  constructor(private readonly options: MockSigningOptions) {}

  /** Simulates the provider being unreachable: every call then fails with PROVIDER_UNAVAILABLE. */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  /** Simulates the signer approving on their device. */
  approve(ref: SessionRef): void {
    this.session(ref).approved = true;
  }

  async startSession(request: SigningRequest): Promise<SessionRef> {
    this.assertAvailable();
    if (!SHA256_HEX.test(request.digestSha256)) throw new DomainError('VALIDATION_FAILED', 422, 'digestSha256');
    const sessionId = randomUUID();
    const expiresAt = new Date(this.options.clock().getTime() + (this.options.ttlMs ?? SIGNING_SESSION_TTL_MS));
    this.sessions.set(sessionId, { request, expiresAt, approved: false, cancelled: false, payload: null });
    return { provider: this.provider, sessionId, expiresAt };
  }

  async collect(ref: SessionRef): Promise<SignedPayload | 'PENDING'> {
    this.assertAvailable();
    const session = this.session(ref);
    if (session.cancelled || this.options.clock() > session.expiresAt) throw new DomainError('SIGNING_SESSION_EXPIRED', 409);
    if (!session.approved) return 'PENDING';
    session.payload ??= {
      cms: await signDigest({
        identity: this.options.identity,
        digest: Buffer.from(session.request.digestSha256, 'hex'),
        signingTime: this.options.clock(),
        ...(this.options.timestamps === undefined ? {} : { timestamps: this.options.timestamps }),
      }),
    };
    return session.payload;
  }

  async cancel(ref: SessionRef): Promise<void> {
    this.assertAvailable();
    this.session(ref).cancelled = true;
  }

  private session(ref: SessionRef): MockSession {
    const session = this.sessions.get(ref.sessionId);
    if (session === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return session;
  }

  private assertAvailable(): void {
    if (!this.available) throw new DomainError('PROVIDER_UNAVAILABLE', 503);
  }
}
