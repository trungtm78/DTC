import { DomainError } from '@machvon/kernel';
import type { TenantTx } from './tenant-database.ts';

/** The SQLSTATE the legal hold trigger raises when a delete would destroy something a hold contains. */
export const LEGAL_HOLD_SQLSTATE = 'LH001';

/** What a purge is about to destroy: a row type (a design table name) and, when the row stands for one, its id. */
export interface PurgeResource {
  type: string;
  id: string | undefined;
}

/** LegalHoldService.isHeld (BR-PLT-04): whether an Active hold that has started contains the resource. */
export async function isHeld(tx: TenantTx, resource: PurgeResource): Promise<boolean> {
  const rows = await tx.query<{ held: boolean }>('select machvon.legal_hold_blocks($1::text, $2::uuid) as held', [resource.type, resource.id ?? null]);
  return rows[0]?.held === true;
}

/** Every purge path calls this before it destroys a record: a held resource is refused with 409 LEGAL_HOLD_ACTIVE. */
export async function assertNotOnHold(tx: TenantTx, resource: PurgeResource): Promise<void> {
  if (await isHeld(tx, resource)) throw new DomainError('LEGAL_HOLD_ACTIVE', 409);
}

/** Maps the database trigger's refusal to the application error; any other failure is not a legal hold violation. */
export function asLegalHoldViolation(error: unknown): DomainError | undefined {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === LEGAL_HOLD_SQLSTATE ? new DomainError('LEGAL_HOLD_ACTIVE', 409) : undefined;
}
