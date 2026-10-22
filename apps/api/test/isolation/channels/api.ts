import { signTenantContext } from '@machvon/kernel';
import type { OpenApiDocument } from '@machvon/contracts';
import { fillPath, operationPath } from '../endpoint-enumerator';
import { TENANT_HEADER } from '../test-auth.guard';
import { UNIT_FIXTURES } from '../suite';
import type { IsolationChannel, TenantName } from '../suite';
import { contextOf, seedTenantUnits } from './database';

export const GET_UNIT_OPERATION = 'get_resources_organization_unit_id';
export const LIST_UNITS_OPERATION = 'get_resources_organization_unit';

/** Operations that this channel exercises with a foreign id (the registered foreign-id cases). */
export const API_FOREIGN_ID_CASES: ReadonlySet<string> = new Set([GET_UNIT_OPERATION]);

export function tokenFor(tenant: TenantName, signingKey: Buffer): string {
  return signTenantContext(contextOf(tenant), signingKey);
}

export interface ApiChannelOptions {
  baseUrl: string;
  signingKey: Buffer;
  ownerUrl: string;
  doc: OpenApiDocument;
}

async function get(baseUrl: string, path: string, token: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { [TENANT_HEADER]: token } });
  return { status: response.status, body: await response.text() };
}

/** Reads through the HTTP API using the real paths of the OpenAPI document and a signed test tenant context. */
export function createApiChannel(options: ApiChannelOptions): IsolationChannel {
  const detailPath = operationPath(options.doc, GET_UNIT_OPERATION);
  const listPath = operationPath(options.doc, LIST_UNITS_OPERATION);
  return {
    name: 'api',
    seed: (tenant) => seedTenantUnits(options.ownerUrl, tenant),
    readAs(user, target) {
      const targetId = UNIT_FIXTURES[target][0]?.id ?? '';
      return get(options.baseUrl, fillPath(detailPath, targetId), tokenFor(user, options.signingKey));
    },
    listAs(user) {
      return get(options.baseUrl, listPath, tokenFor(user, options.signingKey));
    },
  };
}

