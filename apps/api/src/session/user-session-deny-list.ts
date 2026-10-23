import { WORKER_MEMBERSHIP_ID } from '@machvon/db';
import type { TenantContext } from '@machvon/kernel';
import type { SessionDenyList } from '../session-deny-list';

/** The part of UserSessionStore the deny-list needs. */
export interface SessionRevocationSource {
  /** True for a revoked session and for one that does not exist in the tenant. */
  isRevoked(ctx: TenantContext, sessionId: string): Promise<boolean>;
}

export interface UserSessionDenyListOptions {
  /** How long a "not revoked" answer is trusted; the revocation lag budget is 60 s (BR-IAM-13), this stays far inside it. */
  negativeTtlMs?: number;
  now?: () => number;
}

const DEFAULT_NEGATIVE_TTL_MS = 5_000;

/**
 * The deny-list of tenant sessions (IAM 3.4, `sess:revoked:{sid}`), kept in the `user_session` table: a session is
 * denied once its row is revoked or missing. A revocation made in this process takes effect at once (`revoke`); one
 * made elsewhere is seen within `negativeTtlMs`. A revoked answer is final and is never asked twice.
 * Tokens without a tenant (identity-provider sessions of the control plane) are not tracked here.
 */
export class UserSessionDenyList implements SessionDenyList {
  private readonly revoked = new Set<string>();
  private readonly notRevokedUntil = new Map<string, number>();
  private readonly negativeTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly source: SessionRevocationSource,
    options: UserSessionDenyListOptions = {},
  ) {
    this.negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Marks a session revoked in this process before the database is consulted again. */
  revoke(sessionId: string): void {
    this.revoked.add(sessionId);
    this.notRevokedUntil.delete(sessionId);
  }

  /** The number of "not revoked" answers kept in memory (for tests). */
  cachedCount(): number {
    return this.notRevokedUntil.size;
  }

  async isRevoked(sessionId: string, tenantId?: string): Promise<boolean> {
    if (this.revoked.has(sessionId)) return true;
    if (tenantId === undefined) return false;
    const now = this.now();
    const until = this.notRevokedUntil.get(sessionId);
    if (until !== undefined && now < until) return false;
    const ctx: TenantContext = { tenantId, membershipId: WORKER_MEMBERSHIP_ID, scopeVersion: 0 };
    const revoked = await this.source.isRevoked(ctx, sessionId);
    if (revoked) {
      this.revoke(sessionId);
      return true;
    }
    this.sweep(now);
    this.notRevokedUntil.set(sessionId, now + this.negativeTtlMs);
    return false;
  }

  // Expired answers are dropped whenever a new one is stored, so memory follows the live sessions, not their history.
  private sweep(now: number): void {
    for (const [sessionId, until] of this.notRevokedUntil) {
      if (until <= now) this.notRevokedUntil.delete(sessionId);
    }
  }
}
