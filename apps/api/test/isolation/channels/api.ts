import { signTenantContext } from '@machvon/kernel';
import type { OpenApiDocument } from '@machvon/contracts';
import { fillPath, operationPath } from '../endpoint-enumerator';
import { randomUUID } from 'node:crypto';
import { CLAIMS_HEADER, TENANT_HEADER } from '../test-auth.guard';
import { GRANT_FIXTURES, ROLE_FIXTURES, UNIT_FIXTURES } from '../suite';
import type { ForeignAttempt, IsolationChannel, TenantName } from '../suite';
import { contextOf, seedTenantAuthz, seedTenantUnits } from './database';

export const GET_UNIT_OPERATION = 'get_resources_organization_unit_id';
export const LIST_UNITS_OPERATION = 'get_resources_organization_unit';

/** A request of a TNT-A user against a TNT-B object: the registered foreign-id case of one id-bearing operation. */
export interface ForeignAttemptSpec {
  operation: string;
  method: 'GET' | 'PUT' | 'POST';
  /** The TNT-B object the path names. */
  id: string;
  /** Needs `If-Match` (the command is versioned). */
  versioned?: boolean;
  /** A body that is valid for the operation, so the request reaches the handler's own lookup. */
  body?: unknown;
}

const FOREIGN_UNIT = UNIT_FIXTURES['TNT-B'][0]?.id ?? '';
const OWN_UNIT = UNIT_FIXTURES['TNT-A'][0]?.id ?? '';

/** Every id-bearing operation beyond the unit read: reads of role grants and all commands that name an object in the path. */
export const FOREIGN_ATTEMPT_SPECS: readonly ForeignAttemptSpec[] = [
  { operation: 'get_resources_role_grant_id', method: 'GET', id: GRANT_FIXTURES['TNT-B'].id },
  { operation: 'get_resources_role_definition_id', method: 'GET', id: ROLE_FIXTURES['TNT-B'].id },
  { operation: 'updateOrganizationUnit', method: 'PUT', id: FOREIGN_UNIT, versioned: true, body: { name: 'Tên đơn vị mới' } },
  {
    operation: 'moveOrganizationUnit',
    method: 'POST',
    id: FOREIGN_UNIT,
    versioned: true,
    body: { new_parent_id: OWN_UNIT, effective_from: '2026-01-01', reason: 'Isolation foreign move attempt' },
  },
  {
    operation: 'updateCustomRole',
    method: 'PUT',
    id: ROLE_FIXTURES['TNT-B'].id,
    versioned: true,
    body: { permissions: ['iam.unit.manage'], reason: 'Isolation foreign update attempt' },
  },
  {
    operation: 'revokeRoleGrant',
    method: 'POST',
    id: GRANT_FIXTURES['TNT-B'].id,
    versioned: true,
    body: { reason: 'Isolation foreign revoke attempt' },
  },
];

/** Operations that this channel exercises with a foreign id (the registered foreign-id cases). */
export const API_FOREIGN_ID_CASES: ReadonlySet<string> = new Set([GET_UNIT_OPERATION, ...FOREIGN_ATTEMPT_SPECS.map((spec) => spec.operation)]);

export function tokenFor(tenant: TenantName, signingKey: Buffer): string {
  return signTenantContext(contextOf(tenant), signingKey);
}

export interface ApiChannelOptions {
  baseUrl: string;
  signingKey: Buffer;
  ownerUrl: string;
  doc: OpenApiDocument;
  /** Also aim the commands and further reads of FOREIGN_ATTEMPT_SPECS at TNT-B; needs the policy guard and the command pipeline. */
  attempts?: boolean;
}

async function get(baseUrl: string, path: string, token: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { [TENANT_HEADER]: token } });
  return { status: response.status, body: await response.text() };
}

async function attempt(options: ApiChannelOptions, spec: ForeignAttemptSpec, user: TenantName): Promise<ForeignAttempt> {
  const headers: Record<string, string> = {
    [TENANT_HEADER]: tokenFor(user, options.signingKey),
    // Step-up commands (revokeRoleGrant) need a fresh aal2.
    [CLAIMS_HEADER]: JSON.stringify({ aal: 'aal2', aal2At: new Date().toISOString() }),
  };
  if (spec.method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = `isolation-${randomUUID()}`;
  }
  if (spec.versioned === true) headers['if-match'] = '"1"';
  const path = fillPath(operationPath(options.doc, spec.operation), spec.id);
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: spec.method,
    headers,
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
  });
  return { operation: spec.operation, status: response.status, body: await response.text() };
}

/** Reads through the HTTP API using the real paths of the OpenAPI document and a signed test tenant context. */
export function createApiChannel(options: ApiChannelOptions): IsolationChannel {
  const detailPath = operationPath(options.doc, GET_UNIT_OPERATION);
  const listPath = operationPath(options.doc, LIST_UNITS_OPERATION);
  return {
    name: 'api',
    seed: async (tenant) => {
      await seedTenantUnits(options.ownerUrl, tenant);
      await seedTenantAuthz(options.ownerUrl, tenant);
    },
    foreignAttempts:
      options.attempts === true ? async (user) => Promise.all(FOREIGN_ATTEMPT_SPECS.map((spec) => attempt(options, spec, user))) : undefined,
    readAs(user, target) {
      const targetId = UNIT_FIXTURES[target][0]?.id ?? '';
      return get(options.baseUrl, fillPath(detailPath, targetId), tokenFor(user, options.signingKey));
    },
    listAs(user) {
      return get(options.baseUrl, listPath, tokenFor(user, options.signingKey));
    },
  };
}

