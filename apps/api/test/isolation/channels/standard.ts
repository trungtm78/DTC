import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { EffectiveAccessStore, TenantDatabase } from '@machvon/db';
import { TenantCache } from '@machvon/kernel';
import { FileService } from '../../../src/modules/files/file.service';
import { FsObjectStorage } from '../../../src/modules/files/fs-object-storage';
import { MockScanPort } from '../../../src/modules/files/mock-scan';
import type { IsolationChannel } from '../suite';
import { createCacheChannel } from './cache';
import { createExportChannel } from './export';
import { createFileChannel } from './file';
import { createSearchChannel } from './search';

/** A key-value store in memory: what Redis is to the TenantCache in production. */
export class MemoryKeyValueStore {
  readonly entries = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }
}

export interface StandardChannelOptions {
  baseUrl: string;
  signingKey: Buffer;
  ownerUrl: string;
  database: TenantDatabase;
  access: EffectiveAccessStore;
}

/**
 * The four channels of ST-KERNEL-026 beyond the API and the database, built on the real components: the tenant cache, the
 * shared upload pipeline on the file system adapter, global search through the HTTP API, and scheduled exports over
 * tenant transactions. `cleanup` removes the temporary object folder.
 */
export async function createStandardChannels(options: StandardChannelOptions): Promise<{ channels: IsolationChannel[]; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'machvon-isolation-files-'));
  const storage = new FsObjectStorage(root);
  const service = new FileService({ storage, scanner: new MockScanPort(), urlSecret: randomBytes(32) });
  return {
    channels: [
      createCacheChannel(new TenantCache(new MemoryKeyValueStore())),
      createSearchChannel({ baseUrl: options.baseUrl, signingKey: options.signingKey, ownerUrl: options.ownerUrl }),
      createFileChannel({ service, storage }),
      createExportChannel({ database: options.database, access: options.access }),
    ],
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
