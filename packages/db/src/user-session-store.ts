import { DomainError } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import type { TenantDatabase, TenantTx } from './tenant-database.ts';

export type SessionAssurance = 'aal1' | 'aal2';

export interface SessionRecord {
  id: string;
  tenantId: string;
  membershipId: string;
  userAccountId: string;
  idpSessionId: string;
  assurance: SessionAssurance;
}

export interface OpenSessionInput {
  userAccountId: string;
  idpSessionId: string;
  assurance: SessionAssurance;
  ipHash: string;
  userAgentSummary: string;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  membership_id: string;
  user_account_id: string;
  idp_session_id: string;
  assurance_level: SessionAssurance;
}

const UNIQUE_VIOLATION = '23505';

function recordOf(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    userAccountId: row.user_account_id,
    idpSessionId: row.idp_session_id,
    assurance: row.assurance_level,
  };
}

const INSERT_SQL = `insert into machvon.user_session
    (tenant_id, id, user_account_id, membership_id, idp_session_id, assurance_level, ip_hash, user_agent_summary)
  values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6)
  returning id, tenant_id, membership_id, user_account_id, idp_session_id, assurance_level`;

// The first revocation wins: a second one never overwrites its time or its reason.
const REVOKE_SQL = `update machvon.user_session set revoked_at = now(), revoke_reason = $2
  where id = $1::uuid and revoked_at is null`;

const FIND_BY_IDP_SQL = `select id, membership_id, assurance_level, revoked_at is not null as revoked
  from machvon.user_session where idp_session_id = $1 for update`;

// A used key is renamed rather than reused: the row stays as history and the old session id stays revoked, while the
// unique key (tenant, identity-provider session) becomes free for the new selection.
const RETIRE_SQL = `update machvon.user_session
  set revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, $2), idp_session_id = idp_session_id || '#' || id::text
  where id = $1::uuid`;

const TOUCH_SQL = `update machvon.user_session
  set last_seen_at = now(), assurance_level = case when $2 = 'aal2' then 'aal2' else assurance_level end
  where id = $1::uuid
  returning id, tenant_id, membership_id, user_account_id, idp_session_id, assurance_level`;

const REVOKE_IDP_SQL = `update machvon.user_session set revoked_at = now(), revoke_reason = $2
  where idp_session_id = $1 and revoked_at is null returning id`;

const REVOKED_SQL = 'select revoked_at is not null as revoked from machvon.user_session where id = $1::uuid';

/** A bound session; `retiredSessionId` is the session it replaced (another membership, or one that was revoked). */
export interface BoundSession extends SessionRecord {
  retiredSessionId?: string;
}

/** The tenant-plane sessions that tenant tokens are bound to (IAM-003): one row per tenant selection. */
export class UserSessionStore {
  private readonly database: TenantDatabase;

  constructor(database: TenantDatabase) {
    this.database = database;
  }

  async open(ctx: TenantContext, input: OpenSessionInput): Promise<SessionRecord> {
    try {
      const rows = await this.database.withTenant(ctx, (tx) =>
        tx.query<SessionRow>(INSERT_SQL, [input.userAccountId, ctx.membershipId, input.idpSessionId, input.assurance, input.ipHash, input.userAgentSummary]),
      );
      const row = rows[0];
      if (row === undefined) throw new Error('user session insert returned no row');
      return recordOf(row);
    } catch (error) {
      // The pair (tenant, identity-provider session) is unique: a second selection must not reuse it.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new DomainError('VALIDATION_FAILED', 422, 'idp_session_id');
      throw error;
    }
  }

  /**
   * Binds the identity-provider session to the tenant of the caller's transaction (IAM 3.2: one row per tenant
   * selection). The same membership selecting again keeps its live session (a second tab or a token refresh) and
   * only raises its assurance; another membership, or a session that was revoked, gets a new session and the old
   * row is retired under a renamed key, so a revoked session id is never revived.
   */
  async bindInTx(tx: TenantTx, ctx: TenantContext, input: OpenSessionInput): Promise<BoundSession> {
    let retired: string | undefined;
    const [existing] = await tx.query<{ id: string; membership_id: string; revoked: boolean }>(FIND_BY_IDP_SQL, [input.idpSessionId]);
    if (existing !== undefined) {
      if (!existing.revoked && existing.membership_id === ctx.membershipId) {
        const [touched] = await tx.query<SessionRow>(TOUCH_SQL, [existing.id, input.assurance]);
        if (touched === undefined) throw new Error('user session vanished while locked');
        return recordOf(touched);
      }
      await tx.query(RETIRE_SQL, [existing.id, 'REBOUND']);
      retired = existing.id;
    }
    const [created] = await tx.query<SessionRow>(INSERT_SQL, [input.userAccountId, ctx.membershipId, input.idpSessionId, input.assurance, input.ipHash, input.userAgentSummary]);
    if (created === undefined) throw new Error('user session insert returned no row');
    return retired === undefined ? recordOf(created) : { ...recordOf(created), retiredSessionId: retired };
  }

  /** Revokes every live session of one identity-provider session in the tenant (a tenant switch); returns their ids. */
  async revokeIdpSession(ctx: TenantContext, idpSessionId: string, reason: string): Promise<string[]> {
    const rows = await this.database.withTenant(ctx, (tx) => tx.query<{ id: string }>(REVOKE_IDP_SQL, [idpSessionId, reason]));
    return rows.map((row) => row.id);
  }

  async revoke(ctx: TenantContext, sessionId: string, reason: string): Promise<void> {
    await this.database.withTenant(ctx, (tx) => tx.query(REVOKE_SQL, [sessionId, reason]));
  }

  /** A session that does not exist in the tenant counts as revoked, so a forged or foreign id is never accepted. */
  async isRevoked(ctx: TenantContext, sessionId: string): Promise<boolean> {
    const rows = await this.database.withTenant(ctx, (tx) => tx.query<{ revoked: boolean }>(REVOKED_SQL, [sessionId]));
    return rows[0]?.revoked ?? true;
  }
}
