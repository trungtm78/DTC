import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { InvalidObjectKeyError, ownsObjectKey, parseObjectKey, transitionScan } from '@machvon/kernel';
import type { ObjectStoragePort, ScanStatus, StoredObject, TenantContext } from '@machvon/kernel';

const OBJECTS_DIRECTORY = 'objects';
const GENERATION_SUFFIX = '.obj';
const GENERATION_DIGITS = 12;
const TEMPORARY_SUFFIX = '.tmp';
const HEADER_END = 0x0a;
const KIND_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
// A reader that finds the version it chose gone (a newer one was published) looks again.
const READ_ATTEMPTS = 100;
const REMOVE_RETRIES = 20;
const REMOVE_RETRY_DELAY_MS = 20;

interface StoredMeta {
  /** The key the object was stored under: the folder name is a digest of the id, so the key is kept here. */
  key: string;
  contentType: string;
  size: number;
  sha256: string;
  scanStatus: ScanStatus;
  createdAt: string;
}

interface Version {
  meta: StoredMeta;
  bytes: Buffer;
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** A version file: a header line (JSON, no raw line break) and then the bytes, so the two can never be of different versions. */
function encode(meta: StoredMeta, bytes: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(`${JSON.stringify(meta)}\n`, 'utf8'), Buffer.from(bytes)]);
}

function decode(file: Buffer): Version {
  const end = file.indexOf(HEADER_END);
  if (end < 0) throw new Error('object file has no header');
  return { meta: JSON.parse(file.subarray(0, end).toString('utf8')) as StoredMeta, bytes: file.subarray(end + 1) };
}

const versionName = (sequence: number): string => `${String(sequence).padStart(GENERATION_DIGITS, '0')}${GENERATION_SUFFIX}`;
const sequenceOf = (name: string): number => Number(name.slice(0, -GENERATION_SUFFIX.length));

/**
 * MOCK adapter of the object storage port on the file system: a folder per object, `objects/{tenant}/{kind}/{digest of
 * the id}/`, so the tenant prefix of the key is a real folder, ids that differ only in letter case never share a folder
 * and a name the file system reserves can not be an id. A version of the object (bytes and description together) is a
 * file of its own, written whole under a temporary name and then renamed to a new name; the newest file is the object.
 * A reader therefore sees the bytes and the verdict of one version, never a mix, and an interrupted write leaves the
 * previous version in place. Older files are removed once a newer one is in place (one that a reader still holds open is
 * removed by a later write). Writes to one key take turns inside the process. The real adapter (S3 compatible, inside
 * Vietnam) replaces this one behind the same port; the contract suite in the tests is what both must pass.
 */
export class FsObjectStorage implements ObjectStoragePort {
  private readonly turns = new Map<string, Promise<unknown>>();
  private undeleted = 0;

  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** How many superseded files could not be removed yet (a reader had them open); a later write removes them. */
  get supersededFiles(): number {
    return this.undeleted;
  }

  private folderOf(key: string): string {
    const parts = parseObjectKey(key);
    if (parts === undefined) throw new InvalidObjectKeyError('not an object key');
    return join(this.root, OBJECTS_DIRECTORY, parts.tenantId, parts.kind, createHash('sha256').update(parts.id, 'utf8').digest('hex'));
  }

  /** Runs `work` after every earlier piece of work on the same key has finished, whatever its outcome. */
  private exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.turns.get(key) ?? Promise.resolve();
    const next = previous.then(work);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.turns.set(key, tail);
    void tail.then(() => {
      if (this.turns.get(key) === tail) this.turns.delete(key);
    });
    return next;
  }

  private async versions(folder: string): Promise<string[]> {
    try {
      return (await readdir(folder)).filter((name) => name.endsWith(GENERATION_SUFFIX)).sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  /** The newest version of the object in `folder`, or undefined when it holds none. */
  private async current(folder: string): Promise<Version | undefined> {
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
      const newest = (await this.versions(folder)).at(-1);
      if (newest === undefined) return undefined;
      try {
        return decode(await readFile(join(folder, newest)));
      } catch (error) {
        // Superseded or removed between the listing and the read: look at the folder again.
        if (!isMissing(error)) throw error;
      }
    }
    throw new Error('the object kept changing while it was read');
  }

  /** Publishes a new version; the caller holds the turn of the key. */
  private async publish(folder: string, meta: StoredMeta, bytes: Uint8Array): Promise<void> {
    await mkdir(folder, { recursive: true });
    const existing = await this.versions(folder);
    const newest = existing.at(-1);
    const sequence = newest === undefined ? 1 : sequenceOf(newest) + 1;
    const temporary = join(folder, `${versionName(sequence)}.${randomUUID()}${TEMPORARY_SUFFIX}`);
    try {
      await writeFile(temporary, encode(meta, bytes));
      await rename(temporary, join(folder, versionName(sequence)));
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    for (const name of existing) {
      await rm(join(folder, name), { force: true }).catch(() => {
        this.undeleted += 1;
      });
    }
  }

  private describe(meta: StoredMeta): StoredObject {
    return { key: meta.key, size: meta.size, contentType: meta.contentType, sha256: meta.sha256, scanStatus: meta.scanStatus, createdAt: new Date(meta.createdAt) };
  }

  async put(tenant: TenantContext, key: string, bytes: Uint8Array, meta: { contentType: string }): Promise<StoredObject> {
    if (!ownsObjectKey(tenant.tenantId, key)) throw new InvalidObjectKeyError('key is not under the prefix of the tenant');
    const folder = this.folderOf(key);
    // A new content starts unscanned, also when it replaces an older object of the same key.
    const stored: StoredMeta = { key, contentType: meta.contentType, size: bytes.length, sha256: sha256Of(bytes), scanStatus: 'PENDING', createdAt: this.now().toISOString() };
    await this.exclusive(key, () => this.publish(folder, stored, bytes));
    return this.describe(stored);
  }

  async head(tenant: TenantContext, key: string): Promise<StoredObject | undefined> {
    if (!ownsObjectKey(tenant.tenantId, key)) return undefined;
    const found = await this.current(this.folderOf(key));
    return found === undefined ? undefined : this.describe(found.meta);
  }

  async get(tenant: TenantContext, key: string): Promise<{ object: StoredObject; bytes: Uint8Array } | undefined> {
    if (!ownsObjectKey(tenant.tenantId, key)) return undefined;
    const found = await this.current(this.folderOf(key));
    return found === undefined ? undefined : { object: this.describe(found.meta), bytes: new Uint8Array(found.bytes) };
  }

  async setScanStatus(tenant: TenantContext, key: string, status: ScanStatus, expectedSha256?: string): Promise<StoredObject | undefined> {
    if (!ownsObjectKey(tenant.tenantId, key)) return undefined;
    const folder = this.folderOf(key);
    return this.exclusive(key, async () => {
      const found = await this.current(folder);
      if (found === undefined) return undefined;
      // The verdict was reached on other bytes than the ones stored now: it says nothing about these.
      if (expectedSha256 !== undefined && expectedSha256 !== found.meta.sha256) return this.describe(found.meta);
      const next: StoredMeta = { ...found.meta, scanStatus: transitionScan(found.meta.scanStatus, status) };
      await this.publish(folder, next, found.bytes);
      return this.describe(next);
    });
  }

  async remove(tenant: TenantContext, key: string): Promise<boolean> {
    if (!ownsObjectKey(tenant.tenantId, key)) return false;
    const folder = this.folderOf(key);
    return this.exclusive(key, async () => {
      const existed = (await this.versions(folder)).length > 0;
      await rm(folder, { recursive: true, force: true, maxRetries: REMOVE_RETRIES, retryDelay: REMOVE_RETRY_DELAY_MS });
      return existed;
    });
  }

  async list(tenant: TenantContext, kind: string): Promise<StoredObject[]> {
    if (!KIND_PATTERN.test(kind)) return [];
    const kindFolder = join(this.root, OBJECTS_DIRECTORY, tenant.tenantId.toLowerCase(), kind);
    let folders: string[];
    try {
      folders = await readdir(kindFolder);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const objects: StoredObject[] = [];
    for (const name of folders.sort()) {
      const found = await this.current(join(kindFolder, name));
      if (found !== undefined && ownsObjectKey(tenant.tenantId, found.meta.key)) objects.push(this.describe(found.meta));
    }
    return objects.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
}
