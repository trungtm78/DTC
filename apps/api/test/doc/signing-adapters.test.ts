import { X509Certificate, randomUUID } from 'node:crypto';
import { fingerprintOf } from '../../src/modules/doc/cms-verification';
import { MockSigningDirectory, UnconfiguredSigningPort } from '../../src/modules/doc/signing-adapters';
import { MockSigningPort } from '../../src/modules/doc/signing-port';
import { createWorld } from './support/pki-world';

jest.setTimeout(30_000);

const DIGEST = 'a'.repeat(64);
const NOW = new Date('2026-10-23T03:00:00Z');

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
  return 'NO_ERROR';
}

describe('UnconfiguredSigningPort', () => {
  it('says the provider cannot be reached for every call', async () => {
    const port = new UnconfiguredSigningPort();
    const ref = { provider: 'REMOTE_CA' as const, sessionId: randomUUID(), expiresAt: NOW };
    expect(await codeOf(port.startSession())).toBe('PROVIDER_UNAVAILABLE');
    expect(await codeOf(port.collect())).toBe('PROVIDER_UNAVAILABLE');
    expect(await codeOf(port.cancel())).toBe('PROVIDER_UNAVAILABLE');
    expect(port.provider).toBe('REMOTE_CA');
    expect(ref.sessionId).toHaveLength(36);
  });
});

describe('MockSigningDirectory', () => {
  it('sends a session to the identity of the certificate it names and refuses another one', async () => {
    const world = await createWorld();
    const directory = new MockSigningDirectory();
    const leaderFingerprint = fingerprintOf(new X509Certificate(world.leader.certificate));
    directory.register(leaderFingerprint, new MockSigningPort({ identity: world.leader, clock: () => NOW, timestamps: world.tsa }));
    world.setTime(NOW);
    expect(await codeOf(directory.startSession({ digestSha256: DIGEST, certificateFingerprint: 'unknown', correlationId: randomUUID() }))).toBe('CERTIFICATE_NOT_ACTIVE');
    const ref = await directory.startSession({ digestSha256: DIGEST, certificateFingerprint: leaderFingerprint, correlationId: randomUUID() });
    expect(directory.provider).toBe('MOCK');
    expect(await directory.collect(ref)).toBe('PENDING');
    directory.approve(ref);
    const payload = await directory.collect(ref);
    expect(payload).not.toBe('PENDING');
    await directory.cancel(ref);
    expect(await codeOf(directory.collect(ref))).toBe('SIGNING_SESSION_EXPIRED');
  });

  it('knows no session it did not open, and takes every identity down and up together', async () => {
    const world = await createWorld();
    const directory = new MockSigningDirectory();
    const fingerprint = fingerprintOf(new X509Certificate(world.leader.certificate));
    directory.register(fingerprint, new MockSigningPort({ identity: world.leader, clock: () => NOW }));
    const stranger = { provider: 'MOCK' as const, sessionId: randomUUID(), expiresAt: NOW };
    expect(await codeOf(directory.collect(stranger))).toBe('RESOURCE_NOT_FOUND');
    directory.setAvailable(false);
    expect(await codeOf(directory.startSession({ digestSha256: DIGEST, certificateFingerprint: fingerprint, correlationId: randomUUID() }))).toBe('PROVIDER_UNAVAILABLE');
    directory.setAvailable(true);
    expect((await directory.startSession({ digestSha256: DIGEST, certificateFingerprint: fingerprint, correlationId: randomUUID() })).provider).toBe('MOCK');
  });
});
