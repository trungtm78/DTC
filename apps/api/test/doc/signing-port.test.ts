import { X509Certificate, createHash } from 'node:crypto';
import { fingerprintOf, signedDigestOf } from '../../src/modules/doc/cms-verification.ts';
import type { Identity } from '../../src/modules/doc/mock-pki.ts';
import { verifyPdfSignatures } from '../../src/modules/doc/pades-verifier.ts';
import { embedSignature, prepareSignature, signedBytesOf } from '../../src/modules/doc/pdf-signing.ts';
import { SIGNING_PORT_CONTRACT, contractViolations } from '../../src/modules/doc/signing-port.contract.ts';
import type { ContractHarness } from '../../src/modules/doc/signing-port.contract.ts';
import { MockSigningPort, SIGNING_SESSION_TTL_MS } from '../../src/modules/doc/signing-port.ts';
import type { SessionRef, SignedPayload, SigningPort, SigningRequest } from '../../src/modules/doc/signing-port.ts';
import { revisionZero, withNumbering } from './support/pdf-fixture.ts';
import { NOW, SIGNED_AT, createWorld } from './support/pki-world.ts';
import type { World } from './support/pki-world.ts';

let world: World;
let clockTime = SIGNED_AT;

beforeAll(async () => {
  world = await createWorld();
}, 60_000);

beforeEach(() => {
  clockTime = SIGNED_AT;
  world.setTime(SIGNED_AT);
});

function mockHarness(): { harness: ContractHarness; port: MockSigningPort } {
  const port = new MockSigningPort({ identity: world.leader, clock: () => clockTime, timestamps: world.tsa });
  const harness: ContractHarness = {
    port,
    approve: (ref) => port.approve(ref),
    expireSessions: () => {
      clockTime = new Date(clockTime.getTime() + SIGNING_SESSION_TTL_MS + 1000);
    },
    setAvailable: (available) => port.setAvailable(available),
    payloadMatches: (payload, request) => signedDigestOf(payload.cms)?.toString('hex') === request.digestSha256,
    now: () => clockTime,
    certificateFingerprint: fingerprintOf(new X509Certificate(world.leader.certificate)),
  };
  return { harness, port };
}

describe('the MOCK signing adapter', () => {
  it('conforms to the signing port contract', async () => {
    expect(await contractViolations(mockHarness().harness)).toEqual([]);
  });

  it.each(SIGNING_PORT_CONTRACT.map((check) => [check.name, check] as const))('contract: %s', async (_name, check) => {
    await check.run(mockHarness().harness);
  });
});

/** An adapter that misbehaves in one chosen way; the contract must notice each one (negative control). */
function broken(base: MockSigningPort, mode: string): SigningPort {
  return {
    provider: base.provider,
    startSession: (request: SigningRequest) => {
      if (mode === 'any-input') {
        return base.startSession({ ...request, digestSha256: createHash('sha256').update(request.digestSha256).digest('hex') });
      }
      if (mode === 'other-digest') return base.startSession({ ...request, digestSha256: 'ab'.repeat(32) });
      return base.startSession(request);
    },
    collect: async (ref: SessionRef) => {
      if (mode === 'no-pending') base.approve(ref);
      if (mode === 'ignores-expiry') {
        try {
          return await base.collect(ref);
        } catch {
          return 'PENDING';
        }
      }
      const result = await base.collect(ref);
      if (mode === 'leaks-key' && result !== 'PENDING') return { cms: result.cms, privateKey: 'x' } as SignedPayload;
      return result;
    },
    cancel: (ref: SessionRef) => base.cancel(ref),
  };
}

describe('the contract as a negative control', () => {
  it.each([
    ['no-pending', 'answers PENDING until the signer approved'],
    ['any-input', 'accepts only a SHA-256 digest: anything else is refused with VALIDATION_FAILED'],
    ['other-digest', 'returns a signature over exactly the requested digest after approval, the same one every time'],
    ['leaks-key', 'returns nothing but the CMS: no key material crosses the port'],
    ['ignores-expiry', 'refuses a session that has expired with SIGNING_SESSION_EXPIRED, approved or not'],
  ])('notices an adapter that is wrong in the way %s', async (mode, check) => {
    const { harness, port } = mockHarness();
    expect(await contractViolations({ ...harness, port: broken(port, mode) })).toContain(check);
  });

  it('notices an adapter that stays unavailable', async () => {
    const { harness, port } = mockHarness();
    const violations = await contractViolations({ ...harness, setAvailable: () => port.setAvailable(false) });
    expect(violations).toContain('fails with PROVIDER_UNAVAILABLE while the provider is down and works again afterwards');
  });
});

describe('signing through the port with the hash only', () => {
  it('signs the leader and the organisation seal so that the verifier accepts all of it', async () => {
    const leaderPort = new MockSigningPort({ identity: world.leader, clock: () => clockTime, timestamps: world.tsa });
    const sealPort = new MockSigningPort({ identity: world.organization, clock: () => clockTime, timestamps: world.tsa });
    const received: SigningRequest[] = [];

    const sign = async (pdf: Buffer, field: string, port: MockSigningPort, identity: Identity): Promise<Buffer> => {
      const prepared = prepareSignature(pdf, { fieldName: field, signingTime: clockTime });
      const request: SigningRequest = {
        digestSha256: createHash('sha256').update(signedBytesOf(prepared)).digest('hex'),
        certificateFingerprint: fingerprintOf(new X509Certificate(identity.certificate)),
        correlationId: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
      };
      received.push(request);
      const ref = await port.startSession(request);
      expect(await port.collect(ref)).toBe('PENDING');
      port.approve(ref);
      const payload = (await port.collect(ref)) as SignedPayload;
      return embedSignature(prepared, payload.cms);
    };

    const leader = await sign(revisionZero(), 'sig_leader', leaderPort, world.leader);
    clockTime = new Date('2026-10-23T08:10:00Z');
    const numbered = withNumbering(leader, { doc_number: '12', doc_symbol: 'QD', doc_date: '23/10/2026' });
    clockTime = new Date('2026-10-23T08:20:00Z');
    world.setTime(clockTime);
    const sealed = await sign(numbered, 'sig_org', sealPort, world.organization);

    const report = await verifyPdfSignatures(sealed, world.trust, NOW);
    expect(report.overall).toBe('VALID');
    expect(report.signatures.map((signature) => signature.role)).toEqual(['LEADER', 'ORGANIZATION']);
    expect(Object.keys(received[0] ?? {}).sort()).toEqual(['certificateFingerprint', 'correlationId', 'digestSha256']);
    expect(received.every((request) => /^[0-9a-f]{64}$/.test(request.digestSha256))).toBe(true);
  });
});
