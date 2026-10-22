import { randomBytes } from 'node:crypto';
import { TenantDatabase } from '@machvon/db';
import type { TestDatabase } from '@machvon/db/src/test-database';
import { loadErrorRegistry, signTenantContext } from '@machvon/kernel';
import { Client, Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { ERROR_CODES_PATH, startIsolationDatabase, startTestApp } from './test-app';
import type { RunningApp } from './test-app';
import { TENANT_HEADER } from './test-auth.guard';

const KEY = randomBytes(32);
const BIG = '00000000-0000-4000-8000-0000000000c1';
const SMALL = '00000000-0000-4000-8000-0000000000c2';
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000f1';
const TOTAL = 120;

interface Page {
  status: number;
  json: { items?: Array<{ id: string; code: string }>; next_cursor?: string | null; code?: string };
}

describe('organization unit list pagination', () => {
  let database: TestDatabase;
  let app: RunningApp;
  let pool: Pool;

  async function seed(tenantId: string, count: number, prefix: string): Promise<void> {
    const client = new Client({ connectionString: database.urlFor('machvon_owner') });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      await client.query(
        `insert into machvon.organization_unit (tenant_id, id, code, name, valid_from)
         select $1::uuid, ('00000000-0000-4000-${prefix}-' || lpad(to_hex(n), 12, '0'))::uuid,
                '${prefix}' || lpad(n::text, 4, '0'), 'Unit ' || n, date '2026-01-01'
         from generate_series(1, $2::int) as n`,
        [tenantId, count],
      );
      await client.query('commit');
    } finally {
      await client.end();
    }
  }

  async function page(tenantId: string, query: string): Promise<Page> {
    const token = signTenantContext({ tenantId, membershipId: MEMBERSHIP, scopeVersion: 1 }, KEY);
    const response = await fetch(`${app.baseUrl}/resources/organization_unit${query}`, { headers: { [TENANT_HEADER]: token } });
    return { status: response.status, json: (await response.json()) as Page['json'] };
  }

  beforeAll(async () => {
    database = await startIsolationDatabase();
    await seed(BIG, TOTAL, 'c001');
    await seed(SMALL, 7, 'c002');
    pool = new Pool({ connectionString: database.urlFor('machvon_app'), max: 3 });
    app = await startTestApp({
      signingKey: KEY,
      imports: [AppModule.register({ database: new TenantDatabase(pool), registry: loadErrorRegistry(ERROR_CODES_PATH) })],
    });
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
    if (database) await database.stop();
  }, 60_000);

  async function walk(tenantId: string, limit?: number): Promise<{ ids: string[]; pages: number }> {
    const ids: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);
      const result = await page(tenantId, params.size > 0 ? `?${params}` : '');
      expect(result.status).toBe(200);
      ids.push(...(result.json.items ?? []).map((item) => item.id));
      cursor = result.json.next_cursor;
      pages += 1;
    } while (cursor);
    return { ids, pages };
  }

  it('defaults to 50 rows per page and covers every row exactly once, then ends with next_cursor null', async () => {
    const first = await page(BIG, '');
    expect(first.json.items).toHaveLength(50);
    expect(typeof first.json.next_cursor).toBe('string');
    const { ids, pages } = await walk(BIG);
    expect(pages).toBe(3);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(ids.every((id) => id.startsWith('00000000-0000-4000-c001-'))).toBe(true);
    expect([...ids]).toEqual([...ids].sort());
  });

  it('honors an explicit limit and returns next_cursor null when the last page is exactly full', async () => {
    const exact = await page(BIG, `?limit=${TOTAL}`);
    expect(exact.json.items).toHaveLength(TOTAL);
    expect(exact.json.next_cursor).toBeNull();
    const walked = await walk(BIG, 40);
    expect(walked.pages).toBe(3);
    expect(walked.ids).toHaveLength(TOTAL);
    const one = await walk(SMALL, 1);
    expect(one.pages).toBe(7);
  });

  it('never shows another tenant rows on any page', async () => {
    const { ids } = await walk(SMALL, 3);
    expect(ids).toHaveLength(7);
    expect(ids.every((id) => id.startsWith('00000000-0000-4000-c002-'))).toBe(true);
  });

  it('cannot be steered across tenants with a cursor taken from another tenant', async () => {
    const bigFirst = await page(BIG, '?limit=5');
    const cursor = bigFirst.json.next_cursor as string;
    const result = await page(SMALL, `?limit=50&cursor=${cursor}`);
    expect(result.status).toBe(200);
    expect((result.json.items ?? []).every((item) => item.id.startsWith('00000000-0000-4000-c002-'))).toBe(true);
  });

  it.each(['0', '-1', '201', '1.5', 'abc', '', '10x', '1e2'])('rejects limit=%s with 422 VALIDATION_FAILED', async (limit) => {
    const result = await page(BIG, `?limit=${encodeURIComponent(limit)}`);
    expect(result.status).toBe(422);
    expect(result.json.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    'not-base64url!',
    '',
    Buffer.from('plain text').toString('base64url'),
    Buffer.from('[1,2]').toString('base64url'),
    Buffer.from('["c001",  "x"]').toString('base64url'),
    Buffer.from('["c0010001","not-a-uuid"]').toString('base64url'),
    Buffer.from('{"code":"a"}').toString('base64url'),
    `${Buffer.from('["a","00000000-0000-4000-c001-000000000001"]').toString('base64url')}=`,
  ])('rejects cursor %j with 422 VALIDATION_FAILED', async (cursor) => {
    const result = await page(BIG, `?cursor=${encodeURIComponent(cursor)}`);
    expect(result.status).toBe(422);
    expect(result.json.code).toBe('VALIDATION_FAILED');
  });

  it('rejects repeated limit or cursor parameters', async () => {
    expect((await page(BIG, '?limit=5&limit=6')).status).toBe(422);
    expect((await page(BIG, '?cursor=a&cursor=b')).status).toBe(422);
  });
});
