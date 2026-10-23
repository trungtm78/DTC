import { DomainError } from '@machvon/kernel';
import type { TenantContext } from '@machvon/kernel';
import type { TenantDatabase } from './tenant-database.ts';

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

const INSERT_SQL = `insert into machvon.user_session
    (tenant_id, id, user_account_id, membership_id, idp_session_id, assurance_level, ip_hash, user_agent_summary)
  values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6)
  returning id, tenant_id, membership_id, user_account_id, idp_session_id, assurance_level`;

// The first revocation wins: a second one never overwrites its time or its reason.
const REVOKE_SQL = `update machvon.user_session set revoked_at = now(), revoke_reason = $2
  where id = $1::uuid and revoked_at is null`;

const REVOKED_SQL = 'select revoked_at is not null as revoked from machvon.user_session where id = $1::uuid';

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
      return {
        id: row.id,
        tenantId: row.tenant_id,
        membershipId: row.membership_id,
        userAccountId: row.user_account_id,
        idpSessionId: row.idp_session_id,
        assurance: row.assurance_level,
      };
    } catch (error) {
      // The pair (tenant, identity-provider session) is unique: a second selection must not reuse it.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new DomainError('VALIDATION_FAILED', 422, 'idp_session_id');
      throw error;
    }
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
