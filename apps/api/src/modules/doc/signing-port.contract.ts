import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { SessionRef, SignedPayload, SigningPort, SigningRequest } from './signing-port.ts';

/**
 * What the contract needs from the environment of an adapter. The MOCK adapter provides it in-process; a real
 * certification authority adapter provides it against the CA sandbox, so both are held to the same behaviour.
 */
export interface ContractHarness {
  port: SigningPort;
  /** The signer confirms the session (on a real provider: the test signer approving in the sandbox). */
  approve(ref: SessionRef): Promise<void> | void;
  /** Lets every open session run past its expiry. */
  expireSessions(): Promise<void> | void;
  /** Takes the provider down or brings it back. */
  setAvailable(available: boolean): Promise<void> | void;
  /** Whether the payload is a signature over exactly the digest of the request. */
  payloadMatches(payload: SignedPayload, request: SigningRequest): Promise<boolean> | boolean;
  /** The clock the adapter uses for session expiry. */
  now(): Date;
  certificateFingerprint: string;
}

export interface ContractCheck {
  name: string;
  run(harness: ContractHarness): Promise<void>;
}

function freshRequest(harness: ContractHarness): SigningRequest {
  return {
    digestSha256: createHash('sha256').update(randomUUID()).digest('hex'),
    certificateFingerprint: harness.certificateFingerprint,
    correlationId: randomUUID(),
  };
}

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => (error as { code?: string }).code === code);
}

export const SIGNING_PORT_CONTRACT: readonly ContractCheck[] = [
  {
    name: 'opens a session that names its provider and ends in the future',
    async run(harness) {
      const ref = await harness.port.startSession(freshRequest(harness));
      assert.equal(ref.provider, harness.port.provider);
      assert.ok(ref.sessionId.length > 0);
      assert.ok(ref.expiresAt.getTime() > harness.now().getTime());
    },
  },
  {
    name: 'answers PENDING until the signer approved',
    async run(harness) {
      const ref = await harness.port.startSession(freshRequest(harness));
      assert.equal(await harness.port.collect(ref), 'PENDING');
      assert.equal(await harness.port.collect(ref), 'PENDING');
    },
  },
  {
    name: 'returns a signature over exactly the requested digest after approval, the same one every time',
    async run(harness) {
      const request = freshRequest(harness);
      const ref = await harness.port.startSession(request);
      await harness.approve(ref);
      const first = await harness.port.collect(ref);
      assert.notEqual(first, 'PENDING');
      assert.ok(await harness.payloadMatches(first as SignedPayload, request));
      const second = await harness.port.collect(ref);
      assert.deepEqual(second, first);
    },
  },
  {
    name: 'keeps sessions apart: each payload belongs to its own digest',
    async run(harness) {
      const left = freshRequest(harness);
      const right = freshRequest(harness);
      const leftRef = await harness.port.startSession(left);
      const rightRef = await harness.port.startSession(right);
      await harness.approve(leftRef);
      await harness.approve(rightRef);
      const leftPayload = (await harness.port.collect(leftRef)) as SignedPayload;
      const rightPayload = (await harness.port.collect(rightRef)) as SignedPayload;
      assert.ok(await harness.payloadMatches(leftPayload, left));
      assert.ok(await harness.payloadMatches(rightPayload, right));
      assert.equal(await harness.payloadMatches(leftPayload, right), false);
    },
  },
  {
    name: 'accepts only a SHA-256 digest: anything else is refused with VALIDATION_FAILED',
    async run(harness) {
      for (const digestSha256 of ['', 'abc', 'Z'.repeat(64), 'a'.repeat(63), 'a'.repeat(128), 'Hello, this is the document text']) {
        await rejectsWithCode(harness.port.startSession({ ...freshRequest(harness), digestSha256 }), 'VALIDATION_FAILED');
      }
    },
  },
  {
    name: 'refuses to collect an unknown session with RESOURCE_NOT_FOUND',
    async run(harness) {
      const ref = await harness.port.startSession(freshRequest(harness));
      await rejectsWithCode(harness.port.collect({ ...ref, sessionId: randomUUID() }), 'RESOURCE_NOT_FOUND');
    },
  },
  {
    name: 'refuses a session that has expired with SIGNING_SESSION_EXPIRED, approved or not',
    async run(harness) {
      const request = freshRequest(harness);
      const approved = await harness.port.startSession(request);
      await harness.approve(approved);
      const waiting = await harness.port.startSession(freshRequest(harness));
      await harness.expireSessions();
      await rejectsWithCode(harness.port.collect(approved), 'SIGNING_SESSION_EXPIRED');
      await rejectsWithCode(harness.port.collect(waiting), 'SIGNING_SESSION_EXPIRED');
    },
  },
  {
    name: 'ends a cancelled session, and cancelling twice is not an error',
    async run(harness) {
      const ref = await harness.port.startSession(freshRequest(harness));
      await harness.port.cancel(ref);
      await harness.port.cancel(ref);
      await rejectsWithCode(harness.port.collect(ref), 'SIGNING_SESSION_EXPIRED');
    },
  },
  {
    name: 'fails with PROVIDER_UNAVAILABLE while the provider is down and works again afterwards',
    async run(harness) {
      await harness.setAvailable(false);
      try {
        await rejectsWithCode(harness.port.startSession(freshRequest(harness)), 'PROVIDER_UNAVAILABLE');
      } finally {
        await harness.setAvailable(true);
      }
      const ref = await harness.port.startSession(freshRequest(harness));
      assert.equal(await harness.port.collect(ref), 'PENDING');
    },
  },
  {
    name: 'returns nothing but the CMS: no key material crosses the port',
    async run(harness) {
      const ref = await harness.port.startSession(freshRequest(harness));
      await harness.approve(ref);
      const payload = (await harness.port.collect(ref)) as SignedPayload;
      assert.deepEqual(Object.keys(payload), ['cms']);
      assert.ok(!Buffer.from(payload.cms).toString('latin1').includes('PRIVATE KEY'));
    },
  },
];

/** Runs every check against a harness and names the ones the adapter breaks; an empty list means it conforms. */
export async function contractViolations(harness: ContractHarness): Promise<string[]> {
  const violations: string[] = [];
  for (const check of SIGNING_PORT_CONTRACT) {
    try {
      await check.run(harness);
    } catch {
      // Any failure, whatever its cause, is a violation of that check.
      violations.push(check.name);
    }
  }
  return violations;
}
