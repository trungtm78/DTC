import { DomainError } from '@machvon/kernel';
import type { MockSigningPort } from './signing-port';
import type { SessionRef, SignedPayload, SigningPort, SigningProvider, SigningRequest } from './signing-port';

/**
 * The adapter bound until a certification authority is configured: every call says the provider cannot be reached, so
 * a document stays in its state and the signer can try again once an adapter exists (DOC.md F4).
 */
export class UnconfiguredSigningPort implements SigningPort {
  readonly provider: SigningProvider = 'REMOTE_CA';

  startSession(): Promise<SessionRef> {
    return Promise.reject(new DomainError('PROVIDER_UNAVAILABLE', 503));
  }

  collect(): Promise<SignedPayload | 'PENDING'> {
    return Promise.reject(new DomainError('PROVIDER_UNAVAILABLE', 503));
  }

  cancel(): Promise<void> {
    return Promise.reject(new DomainError('PROVIDER_UNAVAILABLE', 503));
  }
}

/**
 * The MOCK adapter with one test identity per certificate: a session goes to the identity whose fingerprint the request
 * names, the way a real provider signs with the key of the certificate it is asked to use.
 */
export class MockSigningDirectory implements SigningPort {
  readonly provider = 'MOCK' as const;
  private readonly byFingerprint = new Map<string, MockSigningPort>();
  private readonly bySession = new Map<string, MockSigningPort>();

  register(fingerprint: string, port: MockSigningPort): void {
    this.byFingerprint.set(fingerprint, port);
  }

  setAvailable(available: boolean): void {
    for (const port of this.byFingerprint.values()) port.setAvailable(available);
  }

  /** Simulates the signer approving on their device. */
  approve(ref: SessionRef): void {
    this.portOf(ref).approve(ref);
  }

  async startSession(request: SigningRequest): Promise<SessionRef> {
    const port = this.byFingerprint.get(request.certificateFingerprint);
    if (port === undefined) throw new DomainError('CERTIFICATE_NOT_ACTIVE', 422, 'certificate_id');
    const ref = await port.startSession(request);
    this.bySession.set(ref.sessionId, port);
    return ref;
  }

  async collect(ref: SessionRef): Promise<SignedPayload | 'PENDING'> {
    return this.portOf(ref).collect(ref);
  }

  async cancel(ref: SessionRef): Promise<void> {
    return this.portOf(ref).cancel(ref);
  }

  private portOf(ref: SessionRef): MockSigningPort {
    const port = this.bySession.get(ref.sessionId);
    if (port === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    return port;
  }
}
