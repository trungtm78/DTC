import { DomainError, asUuid } from '@machvon/kernel';
import type { EffectiveAccess } from '@machvon/kernel';
import { scopePredicate } from './scope-version.ts';
import type { TenantTx } from './tenant-database.ts';

export type SearchClassification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'PERSONAL';

export interface SearchDocumentInput {
  entityType: string;
  entityId: string;
  title: string;
  body?: string;
  classification: SearchClassification;
  ownerUnitId: string;
  /**
   * Path of the owner unit when the document was projected, closed with a slash. It is a record only: a unit can move
   * after the projection was written, so the access scope of the caller is judged on the CURRENT path of the owner
   * unit, read from organization_unit in the same statement.
   */
  ownerUnitPath: string;
}

export interface SearchHit {
  entityType: string;
  entityId: string;
  /** Null for a PERSONAL document: the name of a person is not shown by a search; the detail read decides. */
  title: string | null;
  classification: SearchClassification;
  /** A plain-text extract around the match; null above INTERNAL. */
  snippet: string | null;
}

/** A page of hits. There is deliberately no total: a count would reveal how much exists outside the caller's scope. */
export interface SearchPage {
  items: SearchHit[];
  nextCursor: string | null;
}

export interface SearchParams {
  tenantId: string;
  access: EffectiveAccess;
  /** The permission whose grants decide which units the caller may search (`search.use`). */
  permission: string;
  now: Date;
  query: string;
  limit: number;
  cursor?: string;
}

interface Row {
  entity_type: string;
  entity_id: string;
  title: string;
  classification: SearchClassification;
  snippet: string | null;
  rank: string;
}

const SNIPPET_CLASSIFICATIONS = "('PUBLIC', 'INTERNAL')";
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
// The store takes any entity type text, so a cursor must be able to carry any it handed out; only the size is bounded.
const MAX_ENTITY_TYPE_LENGTH = 256;
// Cover density divided by 1 + log(document length): of two documents that hold the term equally often, the shorter ranks first.
const LENGTH_NORMALISATION = 1;
const ZERO_MANTISSA = /^[0.]*(e|$)/i;

/** Whether PostgreSQL accepts the text as a float8: the cast raises an error on overflow and on underflow to zero. */
function isRepresentableRank(rank: string): boolean {
  const value = Number(rank);
  if (!Number.isFinite(value)) return false;
  return value !== 0 || ZERO_MANTISSA.test(rank);
}

const RANK_PATTERN = /^[0-9]+(\.[0-9]+)?(e-?[0-9]+)?$/i;

function invalidCursor(): DomainError {
  return new DomainError('VALIDATION_FAILED', 422, 'cursor');
}

interface CursorKey {
  rank: string;
  entityId: string;
  entityType: string;
}

/**
 * Opaque cursor: base64url of the JSON array [rank, entityId, entityType] of the last hit of the page. Hits of equal rank
 * follow the entity key, which is stable; the random row id of the projection is never part of the order.
 */
function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify([key.rank, key.entityId, key.entityType]), 'utf8').toString('base64url');
}

function decodeCursor(value: string): CursorKey {
  if (!CURSOR_PATTERN.test(value)) throw invalidCursor();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw invalidCursor();
  const [rank, entityId, entityType] = parsed as unknown[];
  const uuid = asUuid(entityId);
  if (typeof rank !== 'string' || !RANK_PATTERN.test(rank) || !isRepresentableRank(rank) || uuid === undefined) throw invalidCursor();
  if (typeof entityType !== 'string' || entityType === '' || entityType.length > MAX_ENTITY_TYPE_LENGTH) throw invalidCursor();
  const key = { rank, entityId: uuid, entityType };
  if (encodeCursor(key) !== value) throw invalidCursor();
  return key;
}

/**
 * The search projection of a tenant (table search_document). Writing keeps one row per entity; reading filters by tenant
 * (explicitly and by row-level security) and by the access scope of the caller in the same statement that ranks, so a
 * document outside the scope never takes a place in the order, a page or a count. The hits carry no more than the
 * classification allows; opening a hit goes through the detail API, which checks the permission again.
 */
export class SearchProjectionStore {
  /** Inserts or replaces the projection of one entity. */
  async upsert(tx: TenantTx, tenantId: string, input: SearchDocumentInput): Promise<void> {
    await tx.query(
      `insert into machvon.search_document (tenant_id, entity_type, entity_id, title, body, classification, owner_unit_id, owner_unit_path)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id, entity_id, entity_type) do update
         set title = excluded.title, body = excluded.body, classification = excluded.classification,
             owner_unit_id = excluded.owner_unit_id, owner_unit_path = excluded.owner_unit_path, updated_at = now()`,
      [tenantId, input.entityType, input.entityId, input.title, input.body ?? '', input.classification, input.ownerUnitId, input.ownerUnitPath],
    );
  }

  async remove(tx: TenantTx, tenantId: string, entityType: string, entityId: string): Promise<void> {
    await tx.query('delete from machvon.search_document where tenant_id = $1 and entity_type = $2 and entity_id = $3', [tenantId, entityType, entityId]);
  }

  async search(tx: TenantTx, params: SearchParams): Promise<SearchPage> {
    const anchor = params.cursor === undefined ? undefined : decodeCursor(params.cursor);
    // The scope is judged on the unit as it is now (ou), not on the path copied into the projection: a unit that moved out
    // of the caller's subtree must stop showing its documents at once, and a document whose unit is gone is judged on no path.
    const scope = scopePredicate(params.access, params.permission, params.now, { unitPath: 'ou.path', unitId: 'd.owner_unit_id' }, 3);
    const values: unknown[] = [params.query, params.tenantId, ...scope.params];
    const next = (value: unknown): string => {
      values.push(value);
      return `$${values.length}`;
    };
    const after =
      anchor === undefined
        ? ''
        : `where (m.rank < ${next(anchor.rank)}::float8 or (m.rank = ${next(anchor.rank)}::float8 and (m.entity_id, m.entity_type) > (${next(anchor.entityId)}::uuid, ${next(anchor.entityType)}::text)))`;
    const limit = next(params.limit + 1);
    const rows = await tx.query<Row>(
      `with matches as (
         select d.entity_type, d.entity_id, d.title, d.classification,
                ts_rank_cd(d.search_vector, q.tsq, ${LENGTH_NORMALISATION})::float8 as rank,
                case when d.classification in ${SNIPPET_CLASSIFICATIONS}
                     then ts_headline('simple', d.body, q.tsq, 'StartSel="", StopSel="", MaxFragments=1, MaxWords=20, MinWords=5')
                end as snippet
           from machvon.search_document d
           left join machvon.organization_unit ou on ou.tenant_id = d.tenant_id and ou.id = d.owner_unit_id
          cross join (select websearch_to_tsquery('simple', $1) as tsq) q
          where d.tenant_id = $2 and d.search_vector @@ q.tsq and ${scope.sql}
       )
       select m.entity_type, m.entity_id, m.title, m.classification, m.snippet, m.rank::text as rank
         from matches m ${after}
        order by m.rank desc, m.entity_id asc, m.entity_type asc
        limit ${limit}`,
      values,
    );
    const page = rows.slice(0, params.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        title: row.classification === 'PERSONAL' ? null : row.title,
        classification: row.classification,
        snippet: row.snippet === null || row.snippet === '' ? null : row.snippet,
      })),
      nextCursor: rows.length > params.limit && last !== undefined ? encodeCursor({ rank: last.rank, entityId: last.entity_id, entityType: last.entity_type }) : null,
    };
  }
}
