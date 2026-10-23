import { DomainError, versionConflict } from '@machvon/kernel';
import type { SecurityPolicyContent } from '@machvon/kernel';
import type { TenantTx } from './tenant-database.ts';

export type PolicyStatus = 'Draft' | 'Published' | 'Superseded';

export interface SecurityPolicyRow {
  id: string;
  revision: number;
  content: SecurityPolicyContent;
  status: PolicyStatus;
  createdBy: string;
  approvedBy: string | null;
  publishedAt: string | null;
  version: number;
}

/** The ordering key of the last row of a page: revisions come back newest first, so the key is the revision. */
export interface PolicyPageAnchor {
  code: string;
  id: string;
}

interface Row {
  id: string;
  revision: number;
  policy_json: SecurityPolicyContent;
  status: PolicyStatus;
  created_by: string;
  approved_by: string | null;
  published_at: string | null;
  version: string;
}

const COLUMNS = `id, revision, policy_json, status, created_by, approved_by, published_at::text as published_at, version::text as version`;
const REVISION_CURSOR = /^[0-9]{1,9}$/;

function toRow(row: Row): SecurityPolicyRow {
  return {
    id: row.id,
    revision: row.revision,
    content: row.policy_json,
    status: row.status,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    publishedAt: row.published_at,
    version: Number(row.version),
  };
}

/**
 * Security policy versions (ST-ADM-009, ADM 3.10): a draft is made by one administrator and published by another, a
 * published version never changes, and the newest published one is the one in force. Every query runs inside the
 * caller's tenant transaction, so row-level security keeps tenants apart.
 */
export class SecurityPolicyStore {
  /** Creates the next draft revision of the tenant. Revisions are numbered without gaps, one writer at a time. */
  async createDraft(tx: TenantTx, content: SecurityPolicyContent, createdBy: string): Promise<{ id: string; revision: number; version: number }> {
    await tx.query("select pg_advisory_xact_lock(hashtextextended('security_policy:' || current_setting('app.tenant_id'), 0))");
    const rows = await tx.query<{ id: string; revision: number }>(
      `insert into machvon.security_policy_version (tenant_id, id, revision, policy_json, status, created_by, version)
       values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(),
         (select coalesce(max(revision), 0) + 1 from machvon.security_policy_version), $1::jsonb, 'Draft', $2::uuid, 1)
       returning id, revision`,
      [JSON.stringify(content), createdBy],
    );
    const created = rows[0] as { id: string; revision: number };
    return { id: created.id, revision: created.revision, version: 1 };
  }

  async find(tx: TenantTx, id: string): Promise<SecurityPolicyRow | undefined> {
    const rows = await tx.query<Row>(`select ${COLUMNS} from machvon.security_policy_version where id = $1::uuid`, [id]);
    return rows[0] === undefined ? undefined : toRow(rows[0]);
  }

  /** Keyset page, newest revision first. The caller asks for one more row than it shows. */
  async list(tx: TenantTx, request: { limit: number; after: PolicyPageAnchor | undefined }): Promise<SecurityPolicyRow[]> {
    const { after } = request;
    if (after !== undefined && !REVISION_CURSOR.test(after.code)) throw new DomainError('VALIDATION_FAILED', 422, 'cursor');
    const rows = await tx.query<Row>(
      `select ${COLUMNS} from machvon.security_policy_version
        where ($1::int is null or (revision, id) < ($1::int, $2::uuid))
        order by revision desc, id desc
        limit $3`,
      [after === undefined ? null : Number(after.code), after?.id ?? null, request.limit],
    );
    return rows.map(toRow);
  }

  /** The version in force: the newest Published one, or undefined when the tenant never published (the defaults apply). */
  async active(tx: TenantTx): Promise<SecurityPolicyRow | undefined> {
    const rows = await tx.query<Row>(`select ${COLUMNS} from machvon.security_policy_version where status = 'Published' order by revision desc limit 1`);
    return rows[0] === undefined ? undefined : toRow(rows[0]);
  }

  /**
   * Locks a draft for publishing. One that is not there is 404, one that is no longer a draft is 409
   * STAGE_TRANSITION_DENIED (whatever version was sent), a stale version is 409 VERSION_CONFLICT.
   */
  async lockDraft(tx: TenantTx, id: string, expectedVersion: number): Promise<SecurityPolicyRow> {
    const rows = await tx.query<Row>(`select ${COLUMNS} from machvon.security_policy_version where id = $1::uuid for update`, [id]);
    const draft = rows[0] === undefined ? undefined : toRow(rows[0]);
    if (draft === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (draft.status !== 'Draft') throw new DomainError('STAGE_TRANSITION_DENIED', 409);
    if (draft.version !== expectedVersion) throw versionConflict(draft.version);
    return draft;
  }

  /**
   * Publishes a locked draft (four-eyes, BR-ADM-*): the author may not publish it. The version in force until now
   * becomes Superseded in the same transaction, so at no moment are two versions in force.
   */
  async publish(tx: TenantTx, draft: SecurityPolicyRow, approvedBy: string): Promise<{ version: number; supersededId: string | undefined }> {
    if (approvedBy === draft.createdBy) throw new DomainError('SELF_APPROVAL_DENIED', 403);
    const superseded = await tx.query<{ id: string }>(
      "update machvon.security_policy_version set status = 'Superseded', version = version + 1 where status = 'Published' returning id",
    );
    const rows = await tx.query<{ version: string }>(
      `update machvon.security_policy_version
          set status = 'Published', approved_by = $2::uuid, published_at = now(), version = version + 1
        where id = $1::uuid returning version::text as version`,
      [draft.id, approvedBy],
    );
    return { version: Number((rows[0] as { version: string }).version), supersededId: superseded[0]?.id };
  }

  /** The codes of the roles that exist in the tenant: what a policy may name. */
  async roleCodes(tx: TenantTx): Promise<Set<string>> {
    const rows = await tx.query<{ code: string }>("select code from machvon.role_definition where status = 'Active'");
    return new Set(rows.map((row) => row.code));
  }
}
