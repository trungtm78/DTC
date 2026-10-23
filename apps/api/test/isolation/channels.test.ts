import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { APP_FILTER } from '@nestjs/core';
import { EffectiveAccessStore, InMemoryAuthzCache, TenantDatabase } from '@machvon/db';
import type { TestDatabase } from '@machvon/db/src/test-database';
import { TenantCache, loadErrorRegistry, objectKey } from '@machvon/kernel';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { FileService } from '../../src/modules/files/file.service';
import { FsObjectStorage } from '../../src/modules/files/fs-object-storage';
import { MockScanPort } from '../../src/modules/files/mock-scan';
import { ProblemFilter } from '../../src/problem.filter';
import { createCacheChannel } from './channels/cache';
import { seedTenantAuthz, seedTenantUnits, snapshotTenant } from './channels/database';
import { createExportChannel, tenantExportData } from './channels/export';
import { climbingKeyTo, createFileChannel } from './channels/file';
import { LeakyCache, LeakyObjectStorage, LeakySearchController, leakyExportData } from './channels/leaky';
import { createSearchChannel } from './channels/search';
import { MemoryKeyValueStore } from './channels/standard';
import { LEAKY_POOL } from './leaky.controller';
import { TENANT_IDS, TENANT_NAMES, UNIT_FIXTURES, runIsolationSuite } from './suite';
import type { IsolationChannel } from './suite';
import { ERROR_CODES_PATH, startIsolationDatabase, startTestApp } from './test-app';
import type { RunningApp } from './test-app';

const SIGNING_KEY = randomBytes(32);
const OK = { ok: true, leaks: [], uncoveredOperations: [] };

describe('isolation channels beyond the API and the database (ST-KERNEL-024, 025, 026)', () => {
  const pools: Pool[] = [];
  const apps: RunningApp[] = [];
  const folders: string[] = [];
  let database: TestDatabase;
  let tenants: TenantDatabase;
  let access: EffectiveAccessStore;
  let ownerUrl: string;
  let realApp: RunningApp;

  const poolFor = (url: string): Pool => {
    const pool = new Pool({ connectionString: url, max: 3 });
    pools.push(pool);
    return pool;
  };

  const snapshot = (tenant: (typeof TENANT_NAMES)[number]): Promise<string> => snapshotTenant(ownerUrl, tenant);
  const run = (channel: IsolationChannel) => runIsolationSuite({ channels: [channel], idBearingOperations: [], foreignIdCases: new Set(), snapshot });

  async function fileParts(storage?: LeakyObjectStorage | FsObjectStorage) {
    const root = await mkdtemp(join(tmpdir(), 'machvon-isolation-channel-'));
    folders.push(root);
    const used = storage ?? new FsObjectStorage(root);
    return { storage: used, service: new FileService({ storage: used, scanner: new MockScanPort(), urlSecret: randomBytes(32) }) };
  }

  beforeAll(async () => {
    database = await startIsolationDatabase();
    ownerUrl = database.urlFor('machvon_owner');
    tenants = new TenantDatabase(poolFor(database.urlFor('machvon_app')));
    access = new EffectiveAccessStore(tenants, new InMemoryAuthzCache());
    for (const tenant of TENANT_NAMES) {
      await seedTenantUnits(ownerUrl, tenant);
      await seedTenantAuthz(ownerUrl, tenant);
    }
    realApp = await startTestApp({
      signingKey: SIGNING_KEY,
      imports: [
        AppModule.register({
          database: tenants,
          registry: loadErrorRegistry(ERROR_CODES_PATH),
          policy: { database: tenants, access },
        }),
      ],
    });
    apps.push(realApp);
  }, 180_000);

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(pools.map((pool) => pool.end()));
    await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
    if (database) await database.stop();
  }, 60_000);

  describe('cache', () => {
    it('keeps each tenant to its own key: the shared logical name holds its own value and a foreign key or prefix is a miss', async () => {
      expect(await run(createCacheChannel(new TenantCache(new MemoryKeyValueStore())))).toEqual(OK);
    });

    it('(negative control) a cache keyed without the tenant lets TNT-A read TNT-B values', async () => {
      const report = await run(createCacheChannel(new LeakyCache()));
      expect(report.ok).toBe(false);
      expect(report.leaks).toContain('cache: foreign id read answered 200 instead of 404');
      expect(report.leaks).toContain('cache: foreign id read exposes a TNT-B unit name');
      expect(report.leaks).toContain('cache: list exposes a TNT-B unit name');
    });

    it('prefixes every key with t:{tenant_id}: and gives two tenants two values under one name (AC-ST-IAM-001-3, AC-ST-KERNEL-024-1)', async () => {
      const store = new MemoryKeyValueStore();
      const channel = createCacheChannel(new TenantCache(store));
      for (const tenant of TENANT_NAMES) await channel.seed(tenant);
      expect([...store.entries.keys()].every((key) => /^t:[0-9a-f-]{36}:/.test(key))).toBe(true);
      const own = await channel.listAs?.('TNT-A');
      expect(own?.body).toContain(UNIT_FIXTURES['TNT-A'][0]?.name);
      expect(own?.body).not.toContain(UNIT_FIXTURES['TNT-B'][0]?.name);
    });
  });

  describe('file', () => {
    it('answers 404 for a foreign key, link and climbing key and lists only own files', async () => {
      const { service, storage } = await fileParts();
      expect(await run(createFileChannel({ service, storage }))).toEqual(OK);
    });

    it('aims the climbing key at the real key of a TNT-B file: resolved, it names that file', () => {
      const foreignKey = objectKey(TENANT_IDS['TNT-B'], 'document', '11111111-1111-4111-8111-111111111111');
      const climbing = climbingKeyTo(foreignKey, TENANT_IDS['TNT-A']);
      expect(climbing).not.toBe(foreignKey);
      expect(posix.normalize(climbing)).toBe(foreignKey);
    });

    it('(negative control) a storage that finds objects by key alone lets TNT-A download and list TNT-B files', async () => {
      const { service, storage } = await fileParts(new LeakyObjectStorage());
      const report = await run(createFileChannel({ service, storage }));
      expect(report.ok).toBe(false);
      expect(report.leaks).toContain('file: foreign id read answered 200 instead of 404');
      expect(report.leaks).toContain('file: foreign id read exposes a TNT-B unit name');
      expect(report.leaks).toContain('file: list exposes a TNT-B unit name');
    });
  });

  describe('search', () => {
    const channel = (baseUrl: string) => createSearchChannel({ baseUrl, signingKey: SIGNING_KEY, ownerUrl });

    it('returns an empty page for every attempt to find TNT-B data and TNT-A rows only for a shared word (AC-ST-KERNEL-025-1)', async () => {
      expect(await run(channel(realApp.baseUrl))).toEqual(OK);
    });

    it('(negative control) a search without tenant context and access scope on a role that bypasses row-level security leaks TNT-B hits', async () => {
      const leaky = await startTestApp({
        signingKey: SIGNING_KEY,
        controllers: [LeakySearchController],
        providers: [{ provide: LEAKY_POOL, useValue: poolFor(database.adminUrl) }, { provide: APP_FILTER, useValue: new ProblemFilter(loadErrorRegistry(ERROR_CODES_PATH)) }],
      });
      apps.push(leaky);
      const report = await run(channel(leaky.baseUrl));
      expect(report.ok).toBe(false);
      expect(report.leaks).toContain('search: foreign read did not come back empty');
      expect(report.leaks).toContain('search: foreign id read exposes a TNT-B unit name');
      expect(report.leaks).toContain('search: foreign id search:0 exposes a TNT-B unit name');
      // The list is a search for a word both tenants use: only the tenant filter keeps TNT-B out of it.
      expect(report.leaks).toContain('search: list exposes a TNT-B unit name');
    });
  });

  describe('export', () => {
    it('produces rows of the creator tenant only, whatever units the job names, and nothing when the permission is gone', async () => {
      expect(await run(createExportChannel({ database: tenants, access }))).toEqual(OK);
    });

    it('fails the job of a creator who lost the permission and yields no row', async () => {
      const channel = createExportChannel({ database: tenants, access });
      const attempts = await channel.foreignAttempts?.('TNT-A');
      const lost = attempts?.find((attempt) => attempt.operation === 'export:lost-permission');
      expect(lost).toMatchObject({ status: 200, mustBeEmpty: true });
      expect(JSON.parse(lost?.body ?? '{}')).toEqual({ items: [], status: 'FAILED' });
    });

    it('(negative control) an export that trusts the units named in the job on a plain pool leaks TNT-B rows', async () => {
      const leaky = leakyExportData(poolFor(database.adminUrl));
      const report = await run(createExportChannel({ database: tenants, access, data: () => leaky }));
      expect(report.ok).toBe(false);
      expect(report.leaks).toContain('export: foreign read did not come back empty');
      expect(report.leaks).toContain('export: foreign id read exposes a TNT-B unit name');
      expect(report.leaks).toContain('export: list exposes a TNT-B unit name');
    });

    it('exports the own units of the creator through the default data access', async () => {
      const channel = createExportChannel({ database: tenants, access, data: (tenant) => tenantExportData(tenants, tenant) });
      const own = await channel.listAs?.('TNT-A');
      expect(JSON.parse(own?.body ?? '{}')).toMatchObject({ status: 'DONE' });
      for (const unit of UNIT_FIXTURES['TNT-A']) expect(own?.body).toContain(unit.name);
    });
  });
});
