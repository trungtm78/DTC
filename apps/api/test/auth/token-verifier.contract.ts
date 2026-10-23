import { DomainError } from '@machvon/kernel';
import type { TokenVerifier } from '../../src/auth/token-verifier';

/**
 * What a TokenVerifier implementation must provide to be put through the shared contract: the verifier and
 * ready-made tokens, valid ones and refused ones (each refused token carries one flaw).
 */
export interface ContractSubject {
  verifier: TokenVerifier;
  valid: {
    /** Identity token of a staff user, `aal2` through `acr`, subject `subject`, session `sessionId`. */
    identity: string;
    /** Identity token whose audience is the control client, with these realm roles. */
    control: string;
    /** Tenant token for `tenant`, session `sessionId`, mode FULL. */
    tenant: string;
  };
  expected: {
    subject: string;
    sessionId: string;
    controlRoles: readonly string[];
    tenant: { tenantId: string; membershipId: string; scopeVersion: number };
  };
  refusedIdentity: Readonly<Record<string, string>>;
  refusedTenant: Readonly<Record<string, string>>;
}

const GARBAGE: Readonly<Record<string, string>> = {
  empty: '',
  'one segment': 'abc',
  'two segments': 'abc.def',
  'empty segments': '..',
  'not base64': '!!!.???.***',
  'ten thousand characters': 'a'.repeat(10_000),
};

async function failure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectSessionExpired(error: unknown): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(error).toMatchObject({ code: 'SESSION_EXPIRED', status: 401, detail: undefined });
}

/**
 * The behaviour every TokenVerifier must show, whatever it is built on: valid tokens verify to the
 * documented fields; every refused token is a 401 SESSION_EXPIRED that carries no detail.
 */
export function runTokenVerifierContract(name: string, start: () => Promise<{ subject: ContractSubject; stop: () => Promise<void> }>): void {
  describe(`TokenVerifier contract: ${name}`, () => {
    let subject: ContractSubject;
    let stop: () => Promise<void>;

    beforeAll(async () => {
      ({ subject, stop } = await start());
    }, 60_000);

    afterAll(async () => {
      await stop();
    }, 60_000);

    it('verifies an identity token to the subject, the session and the assurance', async () => {
      const identity = await subject.verifier.verifyIdentity(subject.valid.identity);
      expect(identity).toMatchObject({ subject: subject.expected.subject, sessionId: subject.expected.sessionId, assurance: 'aal2', audience: 'tenant-client' });
      expect(identity.aal2At).toBeInstanceOf(Date);
    });

    it('verifies a control token to the control client and its realm roles', async () => {
      const identity = await subject.verifier.verifyIdentity(subject.valid.control);
      expect(identity.audience).toBe('control-client');
      expect([...identity.roles]).toEqual([...subject.expected.controlRoles]);
    });

    it('verifies a tenant token to the tenant context, the session and the mode', async () => {
      const token = await subject.verifier.verifyTenantToken(subject.valid.tenant);
      expect(token.tenant).toEqual(subject.expected.tenant);
      expect(token).toMatchObject({ sessionId: subject.expected.sessionId, mode: 'FULL', audience: 'tenant' });
      expect(token.expiresAt).toBeInstanceOf(Date);
    });

    it('never accepts an identity token as a tenant token, nor a tenant token as an identity token', async () => {
      expectSessionExpired(await failure(subject.verifier.verifyTenantToken(subject.valid.identity)));
      expectSessionExpired(await failure(subject.verifier.verifyIdentity(subject.valid.tenant)));
    });

    describe.each(Object.entries(GARBAGE))('a malformed token (%s)', (_label, token) => {
      it('is refused as an identity token', async () => {
        expectSessionExpired(await failure(subject.verifier.verifyIdentity(token)));
      });

      it('is refused as a tenant token', async () => {
        expectSessionExpired(await failure(subject.verifier.verifyTenantToken(token)));
      });
    });

    it('refuses every flawed identity token with 401 SESSION_EXPIRED and no detail', async () => {
      for (const [label, token] of Object.entries(subject.refusedIdentity)) {
        const error = await failure(subject.verifier.verifyIdentity(token));
        expect({ label, error }).toEqual({ label, error: expect.anything() });
        expectSessionExpired(error);
      }
    });

    it('refuses every flawed tenant token with 401 SESSION_EXPIRED and no detail', async () => {
      for (const [label, token] of Object.entries(subject.refusedTenant)) {
        const error = await failure(subject.verifier.verifyTenantToken(token));
        expect({ label, error }).toEqual({ label, error: expect.anything() });
        expectSessionExpired(error);
      }
    });
  });
}
