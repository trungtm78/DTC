import { DomainError, asUuid } from '@machvon/kernel';
import type { Schemas } from './contract-types';

// The bodies below have already been checked against their schemas in openapi.json by the command pipeline
// (generated validation), so these mappers only rename fields and apply the rules a schema cannot express.

export interface OrgUnitCreateDto {
  code: string;
  name: string;
  parentId: string;
  unitType: string;
  validFrom: string;
  isInvestor?: boolean;
  administrativeCode?: string;
  legalBasisRef?: string;
}

export interface OrgUnitUpdateDto {
  code?: string;
  name?: string;
  isInvestor?: boolean;
  administrativeCode?: string;
  legalBasisRef?: string;
}

export interface OrgUnitMoveDto {
  newParentId: string;
  effectiveFrom: string;
  reason: string;
}

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function orgUnitCreateOf(body: Schemas['OrgUnitCreate']): OrgUnitCreateDto {
  return {
    code: body.code,
    name: body.name,
    parentId: asUuid(body.parent_id) ?? body.parent_id,
    unitType: body.unit_type,
    validFrom: body.valid_from,
    isInvestor: body.is_investor,
    administrativeCode: body.administrative_code,
    legalBasisRef: body.legal_basis_ref,
  };
}

export function orgUnitUpdateOf(body: Schemas['OrgUnitUpdate']): OrgUnitUpdateDto {
  return {
    code: body.code,
    name: body.name,
    isInvestor: body.is_investor,
    administrativeCode: body.administrative_code,
    legalBasisRef: body.legal_basis_ref,
  };
}

/** Today in Vietnam, as YYYY-MM-DD. */
export function todayInVietnam(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: VIETNAM_TIME_ZONE });
}

/**
 * A move takes effect when it is made: the tree keeps one current shape, and moves dated in the future belong to
 * the reorganisation saga (BR-IAM-10), so a future `effective_from` is refused with 422 VALIDATION_FAILED.
 */
export function orgUnitMoveOf(body: Schemas['OrgUnitMove'], today: string = todayInVietnam()): OrgUnitMoveDto {
  if (body.effective_from > today) throw new DomainError('VALIDATION_FAILED', 422, 'effective_from');
  return { newParentId: asUuid(body.new_parent_id) ?? body.new_parent_id, effectiveFrom: body.effective_from, reason: body.reason };
}
