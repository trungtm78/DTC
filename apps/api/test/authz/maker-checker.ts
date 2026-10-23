import { PERMISSIONS, STEP_UP } from '@machvon/contracts';
import type { SystemRole } from '@machvon/db';
import { STEP_UP_WINDOW_MINUTES, holdsPermission } from '@machvon/kernel';
import { evaluateGuardDenial } from './negative-matrix';
import type { MatrixRequest, Observation } from './negative-matrix';

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/**
 * A way to present a step-up credential that the policy must refuse, as the claims the test authentication guard reads.
 * Every one is a credential that was valid once or never proved a second factor, so each is a replay of a session that
 * would not pass a fresh challenge.
 */
export interface StepUpReplay {
  id: string;
  claims(now: Date): Record<string, unknown>;
}

const agedAal2 = (now: Date, minutes: number, seconds = 0): Record<string, unknown> => ({
  aal: 'aal2',
  aal2At: new Date(now.getTime() - minutes * MINUTE_MS - seconds * 1000).toISOString(),
});

export const STEP_UP_REPLAYS: readonly StepUpReplay[] = [
  { id: 'aal1', claims: () => ({ aal: 'aal1' }) },
  { id: 'aal2-without-time', claims: () => ({ aal: 'aal2' }) },
  { id: 'aal2-just-expired', claims: (now) => agedAal2(now, STEP_UP_WINDOW_MINUTES, 1) },
  { id: 'aal2-long-ago', claims: (now) => agedAal2(now, DAY_MINUTES) },
];

export interface StepUpCase {
  id: string;
  operationId: string;
  replay: StepUpReplay;
}

/**
 * One case per step-up command and replay. The commands come from the generated STEP_UP table (`x-step-up` of the
 * contract), so a command that gains a step-up requirement joins the matrix without an edit here.
 */
export function stepUpCasesFor(operationIds: readonly string[]): StepUpCase[] {
  const stepUp = STEP_UP as Readonly<Record<string, string>>;
  return operationIds
    .filter((operationId) => stepUp[operationId] !== undefined)
    .flatMap((operationId) => STEP_UP_REPLAYS.map((replay) => ({ id: `${operationId}:mfa:${replay.id}`, operationId, replay })));
}

/** A command that approves something another person made (BR-ADM-01): the maker may not be the checker. */
export interface ApproverCommand {
  operationId: string;
  /** The request that approves the object `objectId`. */
  build(objectId: string): MatrixRequest;
  /** SQL (run as the table owner in tenant A) that creates the object `objectId` as made by the membership `maker`. */
  seedMadeBy(objectId: string, maker: string): [string, unknown[]];
}

/**
 * The commands that have an approver. A command is declared here by hand because "who made the object" is domain
 * knowledge; the matrix test checks that each one is a command of the matrix, and that the maker is refused while
 * another holder of the same permission is not.
 */
export const APPROVER_COMMANDS: readonly ApproverCommand[] = [
  {
    operationId: 'releaseLegalHold',
    build: (objectId) => ({ method: 'POST', path: `/legal-holds/${objectId}/release`, ifMatch: '"1"', body: { reason: 'maker-checker matrix release' } }),
    seedMadeBy: (objectId, maker) => [
      `insert into machvon.legal_hold (tenant_id, id, resource_scope, authority_reference, reason, effective_at, hold_kind, status, placed_by, version)
       values (current_setting('app.tenant_id')::uuid, $1, '{"kind":"TENANT","ids":[]}'::jsonb, 'MATRIX-MAKER-REF', 'maker-checker matrix hold', '2026-01-01T00:00:00Z', 'AUDIT', 'Active', $2, 1)`,
      [objectId, maker],
    ],
  },
  {
    operationId: 'publishSecurityPolicy',
    build: (objectId) => ({ method: 'POST', path: `/security-policies/${objectId}/publish`, ifMatch: '"1"', body: { reason: 'maker-checker matrix publish' } }),
    seedMadeBy: (objectId, maker) => [
      `insert into machvon.security_policy_version (tenant_id, id, revision, policy_json, status, created_by, version)
       values (current_setting('app.tenant_id')::uuid, $1, (select coalesce(max(revision), 0) + 1 from machvon.security_policy_version), '{"mfa_required_roles":[],"session_idle_minutes":30,"session_max_hours":8}'::jsonb, 'Draft', $2, 1)`,
      [objectId, maker],
    ],
  },
];

export interface MakerCheckerCase {
  id: string;
  operationId: string;
  /** The system role of the maker; it holds the permission of the command, so only the maker rule can refuse it. */
  roleCode: string;
}

export function makerCheckerCasesFor(commands: readonly ApproverCommand[], roles: readonly SystemRole[]): MakerCheckerCase[] {
  return commands.flatMap((command) => {
    const permission = (PERMISSIONS as Readonly<Record<string, string>>)[command.operationId];
    if (permission === undefined) throw new Error(`operation ${command.operationId} has no permission in the generated table`);
    return roles
      .filter((role) => holdsPermission(new Set(role.permissions), permission))
      .map((role) => ({ id: `${command.operationId}:maker:${role.code}`, operationId: command.operationId, roleCode: role.code }));
  });
}

/** Failures of a replay case: refused with MFA_REQUIRED, one DENIED audit row, nothing changed. */
export function evaluateStepUpDenial(observation: Observation): string[] {
  return evaluateGuardDenial(observation, 'MFA_REQUIRED');
}

/** Failures of a maker-checker case: the maker's own approval is refused with SELF_APPROVAL_DENIED and changes nothing. */
export function evaluateSelfApproval(observation: Observation): string[] {
  const failures: string[] = [];
  if (observation.status !== 403) failures.push(`answered ${observation.status} instead of 403`);
  if (observation.code !== 'SELF_APPROVAL_DENIED') failures.push(`code ${String(observation.code)} instead of SELF_APPROVAL_DENIED`);
  if (observation.stateChanged) failures.push('tenant state changed');
  return failures;
}
