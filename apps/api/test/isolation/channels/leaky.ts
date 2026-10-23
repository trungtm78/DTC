import { createHash } from 'node:crypto';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { transitionScan } from '@machvon/kernel';
import type { ObjectStoragePort, ScanStatus, StoredObject, TenantContext } from '@machvon/kernel';
import type { Pool } from 'pg';
import { OperationId } from '../../../src/operation-id.decorator';
import { LEAKY_POOL } from '../leaky.controller';
import type { TenantCacheLike } from './cache';
import type { ExportDataDeps, ExportRow } from './export';


/** Negative control of the cache channel: a cache whose key ignores the tenant, as a hand-rolled `get(name)` would. */
export class LeakyCache implements TenantCacheLike {
  private readonly entries = new Map<string, string>();

  get(_ctx: TenantContext, name: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(name) ?? null);
  }

  set(_ctx: TenantContext, name: string, value: string): Promise<void> {
    this.entries.set(name, value);
    return Promise.resolve();
  }
}

/** Negative control of the file channel: storage that finds an object by its key alone, without asking whose it is. */
export class LeakyObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, { object: StoredObject; bytes: Uint8Array }>();

  put(_tenant: TenantContext, key: string, bytes: Uint8Array, meta: { contentType: string }): Promise<StoredObject> {
    const object: StoredObject = {
      key,
      size: bytes.length,
      contentType: meta.contentType,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      scanStatus: 'PENDING',
      createdAt: new Date(),
    };
    this.objects.set(key, { object, bytes });
    return Promise.resolve(object);
  }

  head(_tenant: TenantContext, key: string): Promise<StoredObject | undefined> {
    return Promise.resolve(this.objects.get(key)?.object);
  }

  get(_tenant: TenantContext, key: string): Promise<{ object: StoredObject; bytes: Uint8Array } | undefined> {
    return Promise.resolve(this.objects.get(key));
  }

  setScanStatus(_tenant: TenantContext, key: string, status: ScanStatus): Promise<StoredObject | undefined> {
    const stored = this.objects.get(key);
    if (stored === undefined) return Promise.resolve(undefined);
    stored.object = { ...stored.object, scanStatus: transitionScan(stored.object.scanStatus, status) };
    return Promise.resolve(stored.object);
  }

  remove(_tenant: TenantContext, key: string): Promise<boolean> {
    return Promise.resolve(this.objects.delete(key));
  }

  list(_tenant: TenantContext, kind: string): Promise<StoredObject[]> {
    return Promise.resolve([...this.objects.values()].filter((entry) => entry.object.key.split('/')[2] === kind).map((entry) => entry.object));
  }
}

/**
 * Negative control of the search channel: `searchGlobal` over a plain pool, without tenant context and without the access
 * scope. On a role that bypasses row-level security it ranks and returns the documents of every tenant.
 */
@Controller()
export class LeakySearchController {
  private readonly pool: Pool;

  constructor(@Inject(LEAKY_POOL) pool: Pool) {
    this.pool = pool;
  }

  @Get('search')
  @OperationId('searchGlobal')
  async search(@Query('q') q: string): Promise<unknown> {
    const result = await this.pool.query(
      `select entity_type, entity_id, title, classification, body as snippet
         from machvon.search_document where search_vector @@ websearch_to_tsquery('simple', $1) order by title`,
      [q],
    );
    return { items: result.rows, next_cursor: null };
  }
}

/**
 * Negative control of the export channel: a scheduled export that trusts the units named in the job. It reads through a
 * plain pool (no tenant context), so every unit of every tenant is "reachable" and every named row is produced.
 */
export function leakyExportData(pool: Pool): ExportDataDeps {
  return {
    reachableUnitIds: async () => (await pool.query<{ id: string }>('select id from machvon.organization_unit')).rows.map((row) => row.id),
    produce: async (unitIds) =>
      (await pool.query<ExportRow>('select id, code, name from machvon.organization_unit where id = any($1::uuid[]) order by code', [unitIds])).rows,
  };
}
