import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { InvalidObjectKeyError, objectKey, ownsObjectKey, parseObjectKey, transitionScan } from '@machvon/kernel';
import type { ObjectStoragePort, ScanStatus, StoredObject, TenantContext } from '@machvon/kernel';

const OBJECTS_DIRECTORY = 'objects';
const META_DIRECTORY = 'meta';
const META_SUFFIX = '.json';
const KIND_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

interface StoredMeta {
  contentType: string;
  size: number;
  sha256: string;
  scanStatus: ScanStatus;
  createdAt: string;
}

/**
 * MOCK adapter of the object storage port on the file system: bytes under `objects/` and one small metadata file under
 * `meta/`, both laid out as `{tenant}/{kind}/{id}`, so the tenant prefix of the key is a real folder. Objects are
 * private by construction (nothing here serves files). The real adapter (S3 compatible, inside Vietnam) replaces it
 * behind the same port; the contract suite in the tests is what both must pass.
 */
export class FsObjectStorage implements ObjectStoragePort {
  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private pathsOf(key: string): { object: string; meta: string } {
    const parts = parseObjectKey(key);
    if (parts === undefined) throw new InvalidObjectKeyError('not an object key');
    const relative = [parts.tenantId, parts.kind, parts.id];
    return { object: join(this.root, OBJECTS_DIRECTORY, ...relative), meta: join(this.root, META_DIRECTORY, parts.tenantId, parts.kind, `${parts.id}${META_SUFFIX}`) };
  }

  private async readMeta(path: string): Promise<StoredMeta | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as StoredMeta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private describe(key: string, meta: StoredMeta): StoredObject {
    return { key, size: meta.size, contentType: meta.contentType, sha256: meta.sha256, scanStatus: meta.scanStatus, createdAt: new Date(meta.createdAt) };
  }

  async put(tenant: TenantContext, key: string, bytes: Uint8Array, meta: { contentType: string }): Promise<StoredObject> {
    if (!ownsObjectKey(tenant.tenantId, key)) throw new InvalidObjectKeyError('key is not under the prefix of the tenant');
    const paths = this.pathsOf(key);
    // A new content starts unscanned, also when it replaces an older object of the same key.
    const stored: StoredMeta = {
      contentType: meta.contentType,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      scanStatus: 'PENDING',
      createdAt: this.now().toISOString(),
    };
    await mkdir(join(paths.object, '..'), { recursive: true });
    await mkdir(join(paths.meta, '..'), { recursive: true });
    await writeFile(paths.object, bytes);
    await writeFile(paths.meta, JSON.stringify(stored));
    return this.describe(key, stored);
  }

  async head(tenant: TenantContext, key: string): Promise<StoredObject | undefined> {
    if (!ownsObjectKey(tenant.tenantId, key)) return undefined;
    const meta = await this.readMeta(this.pathsOf(key).meta);
    return meta === undefined ? undefined : this.describe(key, meta);
  }

  async get(tenant: TenantContext, key: string): Promise<{ object: StoredObject; bytes: Uint8Array } | undefined> {
    const object = await this.head(tenant, key);
    if (object === undefined) return undefined;
    return { object, bytes: new Uint8Array(await readFile(this.pathsOf(key).object)) };
  }

  async setScanStatus(tenant: TenantContext, key: string, status: ScanStatus): Promise<StoredObject | undefined> {
    if (!ownsObjectKey(tenant.tenantId, key)) return undefined;
    const path = this.pathsOf(key).meta;
    const meta = await this.readMeta(path);
    if (meta === undefined) return undefined;
    const next: StoredMeta = { ...meta, scanStatus: transitionScan(meta.scanStatus, status) };
    await writeFile(path, JSON.stringify(next));
    return this.describe(key, next);
  }

  async remove(tenant: TenantContext, key: string): Promise<boolean> {
    if (!ownsObjectKey(tenant.tenantId, key)) return false;
    const paths = this.pathsOf(key);
    const existed = (await this.readMeta(paths.meta)) !== undefined;
    await rm(paths.object, { force: true });
    await rm(paths.meta, { force: true });
    return existed;
  }

  async list(tenant: TenantContext, kind: string): Promise<StoredObject[]> {
    if (!KIND_PATTERN.test(kind)) return [];
    let names: string[];
    try {
      names = await readdir(join(this.root, META_DIRECTORY, tenant.tenantId.toLowerCase(), kind));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const objects: StoredObject[] = [];
    for (const name of names.filter((entry) => entry.endsWith(META_SUFFIX)).sort()) {
      const key = objectKey(tenant.tenantId, kind, name.slice(0, -META_SUFFIX.length));
      const object = await this.head(tenant, key);
      if (object !== undefined) objects.push(object);
    }
    return objects.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
}
