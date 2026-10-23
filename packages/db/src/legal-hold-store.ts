import { DomainError, versionConflict } from '@machvon/kernel';
import type { TenantTx } from './tenant-database.ts';

export type HoldKind = 'INSPECTION' | 'AUDIT' | 'LITIGATION' | 'INVESTIGATION' | 'CONTRACT_END';
export type HoldScopeKind = 'TENANT' | 'UNIT' | 'PROJECT' | 'CONTRACT' | 'RESOURCE';

/** What a hold contains (BR-PLT-04): the whole tenant, or the units, projects, contracts or resources it lists. */
export interface HoldScope {
  kind: HoldScopeKind;
  ids: readonly string[];
}

export interface NewLegalHold {
  holdKind: HoldKind;
  scope: HoldScope;
  authorityReference: string;
  reason: string;
  /** When the hold starts; default: now. */
  effectiveAt?: string | undefined;
}

export interface LegalHoldRow {
  id: string;
  holdKind: HoldKind;
  status: 'Active' | 'Released';
  scope: HoldScope;
  authorityReference: string;
  reason: string;
  effectiveAt: string;
  releasedAt: string | null;
  placedBy: string;
  releasedBy: string | null;
  releaseReason: string | null;
  version: number;
}

/** Where a named id sits in the organisation tree: what the scope check of the caller needs. */
export interface ScopeRef {
  id: string;
  ownerUnitId: string;
  ownerUnitPath: string;
  projectId?: string;
  contractId?: string;
}

/** The ordering key of the last row of a page: holds come back with the Active ones first, then by id. */
export interface HoldPageAnchor {
  code: string;
  id: string;
}

interface Row {
  id: string;
  hold_kind: HoldKind;
  status: 'Active' | 'Released';
  resource_scope: { kind: HoldScopeKind; ids?: string[] };
  authority_reference: string;
  reason: string;
  effective_at: string;
  released_at: string | null;
  placed_by: string;
  released_by: string | null;
  release_reason: string | null;
  version: string;
}

const COLUMNS = `id, hold_kind, status, resource_scope, authority_reference, reason, effective_at::text as effective_at,
  released_at::text as released_at, placed_by, released_by, release_reason, version::text as version`;

const STATUSES: readonly string[] = ['Active', 'Released'];

function toRow(row: Row): LegalHoldRow {
  return {
    id: row.id,
    holdKind: row.hold_kind,
    status: row.status,
    scope: { kind: row.resource_scope.kind, ids: row.resource_scope.ids ?? [] },
    authorityReference: row.authority_reference,
    reason: row.reason,
    effectiveAt: row.effective_at,
    releasedAt: row.released_at,
    placedBy: row.placed_by,
    releasedBy: row.released_by,
    releaseReason: row.release_reason,
    version: Number(row.version),
  };
}

function missingIds(): DomainError {
  return new DomainError('VALIDATION_FAILED', 422, 'resource_scope.ids');
}

/**
 * Legal holds (ST-ADM-003, BR-PLT-04, ADM 3.12). Every query runs inside the caller's tenant transaction, so
 * row-level security keeps tenants apart.
 */
export class LegalHoldStore {
  /** Inserts an Active hold placed by `placedBy` and returns its id; the first version is 1. */
  async place(tx: TenantTx, input: NewLegalHold, placedBy: string): Promise<{ id: string; version: number }> {
    const rows = await tx.query<{ id: string }>(
      `insert into machvon.legal_hold
         (tenant_id, id, resource_scope, authority_reference, reason, effective_at, hold_kind, status, placed_by, version)
       values (nullif(current_setting('app.tenant_id', true), '')::uuid, gen_random_uuid(), $1::jsonb, $2, $3,
         coalesce($4::timestamptz, now()), $5, 'Active', $6::uuid, 1)
       returning id`,
      [JSON.stringify({ kind: input.scope.kind, ids: input.scope.ids }), input.authorityReference, input.reason, input.effectiveAt ?? null, input.holdKind, placedBy],
    );
    return { id: (rows[0] as { id: string }).id, version: 1 };
  }

  async find(tx: TenantTx, id: string): Promise<LegalHoldRow | undefined> {
    const rows = await tx.query<Row>(`select ${COLUMNS} from machvon.legal_hold where id = $1::uuid`, [id]);
    return rows[0] === undefined ? undefined : toRow(rows[0]);
  }

  /**
   * Locks a hold for release. A hold that is not there is 404, one already released is 409 LEGAL_HOLD_STATE_INVALID
   * (whatever the version the caller sent), and a stale version is 409 VERSION_CONFLICT.
   */
  async lock(tx: TenantTx, id: string, expectedVersion: number): Promise<LegalHoldRow> {
    const rows = await tx.query<Row>(`select ${COLUMNS} from machvon.legal_hold where id = $1::uuid for update`, [id]);
    const hold = rows[0] === undefined ? undefined : toRow(rows[0]);
    if (hold === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
    if (hold.status !== 'Active') throw new DomainError('LEGAL_HOLD_STATE_INVALID', 409);
    if (hold.version !== expectedVersion) throw versionConflict(hold.version);
    return hold;
  }

  /** Releases a locked hold (BR-ADM-01): the person who placed it may not release it. */
  async release(tx: TenantTx, hold: LegalHoldRow, releasedBy: string, reason: string): Promise<{ version: number }> {
    if (releasedBy === hold.placedBy) throw new DomainError('SELF_APPROVAL_DENIED', 403);
    const rows = await tx.query<{ version: string }>(
      `update machvon.legal_hold
          set status = 'Released', released_at = now(), released_by = $2::uuid, release_reason = $3, version = version + 1
        where id = $1::uuid
        returning version::text as version`,
      [hold.id, releasedBy, reason],
    );
    return { version: Number((rows[0] as { version: string }).version) };
  }

  /** Keyset page: Active holds first, then by id. The caller asks for one more row than it shows. */
  async list(tx: TenantTx, request: { limit: number; after: HoldPageAnchor | undefined }): Promise<LegalHoldRow[]> {
    const { after } = request;
    if (after !== undefined && !STATUSES.includes(after.code)) throw new DomainError('VALIDATION_FAILED', 422, 'cursor');
    const rows = await tx.query<Row>(
      `select ${COLUMNS} from machvon.legal_hold
        where ($1::text is null or (status, id) > ($1::text, $2::uuid))
        order by status, id
        limit $3`,
      [after?.code ?? null, after?.id ?? null, request.limit],
    );
    return rows.map(toRow);
  }

  /**
   * The place in the organisation tree of every id a hold names, in the order named, for the caller's scope check
   * (a TENANT or RESOURCE hold has none). An id that does not exist in the tenant is a 422 naming the field.
   */
  async resolveScopeRefs(tx: TenantTx, scope: HoldScope): Promise<ScopeRef[]> {
    if (scope.kind === 'TENANT' || scope.kind === 'RESOURCE') return [];
    const ids = [...scope.ids];
    const rows = await tx.query<{ id: string; owner_unit_id: string; owner_unit_path: string; project_id: string | null; contract_id: string | null }>(RESOLVE[scope.kind], [ids]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => {
      const row = byId.get(id);
      if (row === undefined) throw missingIds();
      const ref: ScopeRef = { id, ownerUnitId: row.owner_unit_id, ownerUnitPath: row.owner_unit_path };
      if (row.project_id !== null) ref.projectId = row.project_id;
      if (row.contract_id !== null) ref.contractId = row.contract_id;
      return ref;
    });
  }
}

const RESOLVE: Record<'UNIT' | 'PROJECT' | 'CONTRACT', string> = {
  UNIT: `select u.id, u.id as owner_unit_id, u.path as owner_unit_path, null::uuid as project_id, null::uuid as contract_id
           from machvon.organization_unit u where u.id = any($1::uuid[])`,
  PROJECT: `select p.id, u.id as owner_unit_id, u.path as owner_unit_path, p.id as project_id, null::uuid as contract_id
              from machvon.project p join machvon.organization_unit u on u.id = p.owner_unit_id where p.id = any($1::uuid[])`,
  CONTRACT: `select c.id, u.id as owner_unit_id, u.path as owner_unit_path, c.project_id, c.id as contract_id
               from machvon.contract c
               join machvon.project p on p.id = c.project_id
               join machvon.organization_unit u on u.id = p.owner_unit_id
              where c.id = any($1::uuid[])`,
};
