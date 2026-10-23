import { Client } from 'pg';
import { TENANT_HEADER } from '../test-auth.guard';
import { TENANT_IDS, UNIT_FIXTURES } from '../suite';
import type { ForeignAttempt, IsolationChannel, TenantName } from '../suite';
import { tokenFor } from './api';

const INSERT_DOCUMENT = `insert into machvon.search_document (tenant_id, entity_type, entity_id, title, body, classification, owner_unit_id, owner_unit_path)
  values ($1, 'organization_unit', $2, $3, $4, 'INTERNAL', $2, $5) on conflict do nothing`;

/** A word in the body of the documents of every tenant: a search for it matches both tenants, so only the tenant filter tells them apart. */
export const SHARED_TERM = 'ledger';

/** Projects the units of a tenant (the title is the unit name, the body its code and the shared term) as machvon_owner with the tenant set. */
export async function seedSearchDocuments(ownerUrl: string, tenant: TenantName): Promise<void> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true)", [TENANT_IDS[tenant]]);
    for (const unit of UNIT_FIXTURES[tenant]) await client.query(INSERT_DOCUMENT, [TENANT_IDS[tenant], unit.id, unit.name, `${unit.code} ${SHARED_TERM}`, `/${unit.id}/`]);
    await client.query('commit');
  } finally {
    await client.end();
  }
}

export interface SearchChannelOptions {
  baseUrl: string;
  signingKey: Buffer;
  ownerUrl: string;
}

/**
 * Global search as a way to read another tenant's data. A TNT-A user searches for the name, the code and the id of TNT-B
 * units and for words only TNT-B uses: every answer must be an empty page without an error, and a search for words
 * both use must return TNT-A rows only. The suite accepts an empty page here instead of 404: a search has no object to
 * be "not found", and the answer must not tell a hidden match from no match.
 */
export function createSearchChannel(options: SearchChannelOptions): IsolationChannel {
  async function search(user: TenantName, query: string, limit = 50): Promise<{ status: number; body: string }> {
    const response = await fetch(`${options.baseUrl}/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      headers: { [TENANT_HEADER]: tokenFor(user, options.signingKey) },
    });
    return { status: response.status, body: await response.text() };
  }

  return {
    name: 'search',
    foreignReadOutcome: 'empty',
    seed: (tenant) => seedSearchDocuments(options.ownerUrl, tenant),
    readAs: (user, target) => search(user, UNIT_FIXTURES[target][0]?.name ?? ''),
    // The list is the search for the shared term: it matches the documents of both tenants, so a search that
    // filters by the query alone would return TNT-B rows too.
    listAs: (user) => search(user, SHARED_TERM, 200),
    async foreignAttempts(user): Promise<ForeignAttempt[]> {
      const [first] = UNIT_FIXTURES['TNT-B'];
      const queries = ['Beta', first?.code ?? '', first?.id ?? '', TENANT_IDS['TNT-B'], 'Bí mật', '"Phòng Dự án Beta"'];
      const attempts: ForeignAttempt[] = [];
      for (const [index, query] of queries.entries()) attempts.push({ operation: `search:${index}`, ...(await search(user, query)), expectedStatuses: [200] });
      return attempts;
    },
  };
}
