import { DomainError, versionConflict } from '@machvon/kernel';
import type { TenantTx } from './tenant-database.ts';

/** BR-IAM-09: depth counts edges from the root, the root being 0, and may not pass 8 (also a table CHECK). */
export const MAX_UNIT_DEPTH = 8;

const UNIQUE_VIOLATION = '23505';

export interface CreateUnitInput {
  code: string;
  name: string;
  parentId: string;
  unitType: string;
  /** ISO dates (YYYY-MM-DD). */
  validFrom: string;
  validUntil?: string | null;
  isInvestor?: boolean;
  administrativeCode?: string | null;
  legalBasisRef?: string | null;
}

export interface UnitPatch {
  code?: string;
  name?: string;
  isInvestor?: boolean;
  administrativeCode?: string | null;
  legalBasisRef?: string | null;
}

interface UnitRow {
  id: string;
  parent_id: string | null;
  path: string;
  depth: number;
  version: string;
  valid_from: string;
  valid_until: string | null;
}

// Whole-tree structure changes of one tenant run one after the other, so two opposing moves cannot both pass the
// cycle check, and the subtree row locks below can never be taken in conflicting orders.
const TREE_LOCK_SQL = "select pg_advisory_xact_lock(hashtextextended('org_unit_tree:' || current_setting('app.tenant_id'), 0))";

const UNIT_COLUMNS = 'id, parent_id, path, depth, version::text as version, valid_from::text as valid_from, valid_until::text as valid_until';

async function lockTree(tx: TenantTx): Promise<void> {
  await tx.query(TREE_LOCK_SQL);
}

async function findUnit(tx: TenantTx, id: string, forUpdate: boolean): Promise<UnitRow> {
  const rows = await tx.query<UnitRow>(`select ${UNIT_COLUMNS} from machvon.organization_unit where id = $1::uuid${forUpdate ? ' for update' : ''}`, [id]);
  const row = rows[0];
  // A unit of another tenant is invisible to the transaction, so it is indistinguishable from a missing one.
  if (row === undefined) throw new DomainError('RESOURCE_NOT_FOUND', 404);
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** Child validity must be a proper interval inside the parent's (BR-IAM-09). */
function assertValidityInside(parent: UnitRow, validFrom: string, validUntil: string | null): void {
  const startsBefore = validFrom < parent.valid_from;
  const endsAfter = parent.valid_until !== null && (validUntil === null || validUntil > parent.valid_until);
  const startsAfterParentEnd = parent.valid_until !== null && validFrom >= parent.valid_until;
  const notAnInterval = validUntil !== null && validFrom >= validUntil;
  if (startsBefore || endsAfter || startsAfterParentEnd || notAnInterval) throw new DomainError('UNIT_VALIDITY_INVALID', 422);
}

async function insertUnit(tx: TenantTx, input: CreateUnitInput, parent: UnitRow): Promise<{ id: string; path: string; depth: number; version: number }> {
  try {
    const rows = await tx.query<{ id: string; path: string; depth: number }>(
      `with new_id as (select gen_random_uuid() as id)
       insert into machvon.organization_unit
         (tenant_id, id, code, name, parent_id, valid_from, valid_until, unit_type, administrative_code, is_investor, legal_basis_ref, path, depth, status)
       select nullif(current_setting('app.tenant_id', true), '')::uuid, new_id.id, $1, $2, $3::uuid, $4::date, $5::date, $6, $7::text, $8::boolean, $9::text,
              $10 || new_id.id::text || '/', $11::int,
              case when $4::date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then 'Planned' else 'Active' end
       from new_id
       returning id, path, depth`,
      [
        input.code,
        input.name,
        parent.id,
        input.validFrom,
        input.validUntil ?? null,
        input.unitType,
        input.administrativeCode ?? null,
        input.isInvestor ?? false,
        input.legalBasisRef ?? null,
        parent.path,
        parent.depth + 1,
      ],
    );
    const created = rows[0];
    if (created === undefined) throw new Error('organization unit insert returned no row');
    return { id: created.id, path: created.path, depth: created.depth, version: 1 };
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('UNIT_CODE_TAKEN', 409);
    throw error;
  }
}

export interface UnitView {
  id: string;
  parentId: string | null;
  path: string;
  depth: number;
  version: number;
}

/** Serialises tree structure changes of the tenant for the rest of the transaction (re-entrant). */
export async function lockUnitTree(tx: TenantTx): Promise<void> {
  await lockTree(tx);
}

/** Reads one unit (RESOURCE_NOT_FOUND when it is missing or belongs to another tenant). */
export async function loadUnit(tx: TenantTx, id: string): Promise<UnitView> {
  const row = await findUnit(tx, id, false);
  return { id: row.id, parentId: row.parent_id, path: row.path, depth: row.depth, version: Number(row.version) };
}

/** A unit of a subtree: what a scope check needs to decide whether the unit is inside someone's reach. */
export interface SubtreeUnit {
  id: string;
  path: string;
}

/** A unit and all its descendants with their paths, in path order. */
export async function subtreeUnits(tx: TenantTx, path: string): Promise<SubtreeUnit[]> {
  return tx.query<SubtreeUnit>('select id, path from machvon.organization_unit where starts_with(path, $1) order by path', [path]);
}

/** The ids of a unit and all its descendants, in path order. */
export async function subtreeUnitIds(tx: TenantTx, path: string): Promise<string[]> {
  return (await subtreeUnits(tx, path)).map((unit) => unit.id);
}

/** Creates a unit below an existing parent (the root of a tenant is seeded at provisioning, never created here). */
export async function createUnit(tx: TenantTx, input: CreateUnitInput): Promise<{ id: string; path: string; depth: number; version: number }> {
  await lockTree(tx);
  const parent = await findUnit(tx, input.parentId, true);
  if (parent.depth + 1 > MAX_UNIT_DEPTH) throw new DomainError('UNIT_DEPTH_EXCEEDED', 422);
  assertValidityInside(parent, input.validFrom, input.validUntil ?? null);
  return insertUnit(tx, input, parent);
}

/** Changes descriptive fields; `expectedVersion` is the parsed If-Match. Returns the new version. */
export async function updateUnit(tx: TenantTx, id: string, patch: UnitPatch, expectedVersion: number): Promise<{ version: number }> {
  const current = await findUnit(tx, id, true);
  if (Number(current.version) !== expectedVersion) throw versionConflict(Number(current.version));
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.code !== undefined) set('code', patch.code);
  if (patch.name !== undefined) set('name', patch.name);
  if (patch.isInvestor !== undefined) set('is_investor', patch.isInvestor);
  if (patch.administrativeCode !== undefined) set('administrative_code', patch.administrativeCode);
  if (patch.legalBasisRef !== undefined) set('legal_basis_ref', patch.legalBasisRef);
  if (sets.length === 0) return { version: Number(current.version) };
  try {
    const rows = await tx.query<{ version: string }>(
      `update machvon.organization_unit set ${sets.join(', ')}, version = version + 1 where id = $1::uuid returning version::text as version`,
      params,
    );
    return { version: Number(rows[0]?.version) };
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('UNIT_CODE_TAKEN', 409);
    throw error;
  }
}

export interface MoveResult {
  affectedUnitIds: string[];
  oldPath: string;
  newPath: string;
  version: number;
}

/**
 * Moves a unit and its whole subtree below another parent in one transaction. The subtree is locked first, then every
 * path and depth is rewritten by a single UPDATE, so a failure leaves all old paths. `expectedVersion` is the parsed
 * If-Match, or null when the caller does not check one.
 */
export async function moveUnit(tx: TenantTx, id: string, newParentId: string, expectedVersion: number | null): Promise<MoveResult> {
  await lockTree(tx);
  const unit = await findUnit(tx, id, true);
  if (expectedVersion !== null && Number(unit.version) !== expectedVersion) throw versionConflict(Number(unit.version));
  const parent = await findUnit(tx, newParentId, true);
  if (parent.id === unit.id || parent.path.startsWith(unit.path)) throw new DomainError('UNIT_CYCLE', 422);
  if (unit.parent_id === parent.id) return { affectedUnitIds: [], oldPath: unit.path, newPath: unit.path, version: Number(unit.version) };

  const subtree = await tx.query<{ id: string; depth: number }>(
    'select id, depth from machvon.organization_unit where starts_with(path, $1) order by path for update',
    [unit.path],
  );
  const delta = parent.depth + 1 - unit.depth;
  const deepest = subtree.reduce((max, row) => Math.max(max, row.depth), unit.depth);
  if (deepest + delta > MAX_UNIT_DEPTH) throw new DomainError('UNIT_DEPTH_EXCEEDED', 422);
  assertValidityInside(parent, unit.valid_from, unit.valid_until);

  const newPath = `${parent.path}${unit.id}/`;
  const updated = await tx.query<{ id: string; version: string }>(
    `update machvon.organization_unit
        set path = $2 || substr(path, length($1) + 1),
            depth = depth + $3::int,
            parent_id = case when id = $4::uuid then $5::uuid else parent_id end,
            version = version + 1
      where starts_with(path, $1)
      returning id, version::text as version`,
    [unit.path, newPath, delta, unit.id, parent.id],
  );
  const moved = updated.find((row) => row.id === unit.id);
  return { affectedUnitIds: subtree.map((row) => row.id), oldPath: unit.path, newPath, version: Number(moved?.version ?? unit.version) };
}
