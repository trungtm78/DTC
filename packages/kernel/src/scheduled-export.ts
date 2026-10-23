import { canonicalJson, sha256Hex } from './canonical-json.ts';
import { effectivePermissions, holdsPermission } from './effective-access.ts';
import type { EffectiveAccess } from './effective-access.ts';

/** A scheduled export as it was created: by whom, under which permission, over which organisation units. */
export interface ScheduledExportJob {
  id: string;
  /** The membership whose permission the export runs under, at run time. */
  createdBy: string;
  permission: string;
  unitIds: readonly string[];
}

export interface ScheduledExportDeps<Row> {
  now(): Date;
  loadAccess(membershipId: string): Promise<EffectiveAccess>;
  /** The organisation units that the access reaches for the permission right now (grants resolved to units, in the tenant of the job). */
  reachableUnitIds(access: EffectiveAccess, permission: string, now: Date): Promise<readonly string[]>;
  produce(unitIds: readonly string[]): Promise<Row[]>;
}

export type ScheduledExportOutcome<Row> =
  | { status: 'FAILED'; code: 'SCOPE_DENIED'; reason: 'PERMISSION_LOST' | 'NO_UNIT_IN_SCOPE' }
  | { status: 'DONE'; rows: Row[]; unitIds: string[]; narrowed: boolean; scopeHash: string };

/**
 * Runs a scheduled export under the creator's permission as it is now, not as it was when the job was made
 * (NFR-TENANCY-06). The file holds the intersection of the units of the job and the units reachable today: a unit
 * gained since never widens it, a unit revoked since drops out, and the hash of the units actually exported is returned
 * for the job audit. When the permission is gone, or nothing of the job is reachable any more, nothing is produced.
 */
export async function runScheduledExport<Row>(job: ScheduledExportJob, deps: ScheduledExportDeps<Row>): Promise<ScheduledExportOutcome<Row>> {
  const now = deps.now();
  const access = await deps.loadAccess(job.createdBy);
  if (!holdsPermission(effectivePermissions(access, now), job.permission)) return { status: 'FAILED', code: 'SCOPE_DENIED', reason: 'PERMISSION_LOST' };
  const wanted = new Set(job.unitIds);
  const reachable = new Set(await deps.reachableUnitIds(access, job.permission, now));
  const unitIds = [...wanted].filter((unitId) => reachable.has(unitId)).sort();
  if (unitIds.length === 0) return { status: 'FAILED', code: 'SCOPE_DENIED', reason: 'NO_UNIT_IN_SCOPE' };
  const rows = await deps.produce(unitIds);
  return { status: 'DONE', rows, unitIds, narrowed: unitIds.length < wanted.size, scopeHash: sha256Hex(canonicalJson({ unitIds })) };
}
