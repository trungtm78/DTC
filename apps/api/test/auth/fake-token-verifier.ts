import { DomainError } from '@machvon/kernel';
import type { TokenVerifier, VerifiedIdentity, VerifiedTenantToken } from '../../src/auth/token-verifier';

/**
 * The test double of the authentication port for the tests of other modules: it knows exactly the tokens that
 * were registered and refuses everything else with the same 401 as the real adapter.
 */
export class FakeTokenVerifier implements TokenVerifier {
  private readonly identities = new Map<string, VerifiedIdentity>();
  private readonly tenantTokens = new Map<string, VerifiedTenantToken>();
  identityCalls = 0;
  tenantCalls = 0;

  registerIdentity(token: string, identity: VerifiedIdentity): string {
    this.identities.set(token, identity);
    return token;
  }

  registerTenant(token: string, verified: VerifiedTenantToken): string {
    this.tenantTokens.set(token, verified);
    return token;
  }

  verifyIdentity(token: string): Promise<VerifiedIdentity> {
    this.identityCalls += 1;
    const identity = this.identities.get(token);
    return identity === undefined ? Promise.reject(new DomainError('SESSION_EXPIRED', 401)) : Promise.resolve(identity);
  }

  verifyTenantToken(token: string): Promise<VerifiedTenantToken> {
    this.tenantCalls += 1;
    const verified = this.tenantTokens.get(token);
    return verified === undefined ? Promise.reject(new DomainError('SESSION_EXPIRED', 401)) : Promise.resolve(verified);
  }
}
