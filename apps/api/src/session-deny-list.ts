/** The sess:revoked:{sid} deny-list of IAM 3.4; the Redis implementation arrives with the Redis onboarding. */
export interface SessionDenyList {
  /** `tenantId` is the tenant of a tenant token, for stores that keep sessions per tenant; control-plane sessions have none. */
  isRevoked(sessionId: string, tenantId?: string): Promise<boolean>;
}

export class InMemorySessionDenyList implements SessionDenyList {
  private readonly revoked = new Set<string>();

  revoke(sessionId: string): void {
    this.revoked.add(sessionId);
  }

  isRevoked(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.revoked.has(sessionId));
  }
}
