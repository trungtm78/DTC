export interface StoredFile {
  bytes: Uint8Array;
  mime: string;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Where the bytes of document versions live (BR-DOC-16, BR-DOC-19). An object is written once: the same key with the
 * same bytes is accepted again, the same key with other bytes is refused, so a stored version never changes.
 * Downloads go through a short-lived signed URL; the port never serves a file by itself.
 */
export interface DocumentFilePort {
  /** Stores the bytes under the key; resolves when they are durable. Throws when the key holds other bytes. */
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** The stored file, or undefined when the key holds nothing. */
  get(key: string): Promise<StoredFile | undefined>;
  /** A URL that serves the object until `now + ttlSeconds`; throws when the key holds nothing. */
  signedUrl(key: string, ttlSeconds: number, now: Date): Promise<SignedUrl>;
}

/** Injection token of the file port. */
export const DOCUMENT_FILE_PORT = Symbol('DOCUMENT_FILE_PORT');

/** The in-memory adapter (MOCK): used until the object storage of the platform is bound (KERNEL-024). */
export class MockDocumentFilePort implements DocumentFilePort {
  private readonly files = new Map<string, StoredFile>();

  put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    const existing = this.files.get(key);
    if (existing !== undefined) {
      if (Buffer.from(existing.bytes).equals(Buffer.from(bytes)) && existing.mime === mime) return Promise.resolve();
      return Promise.reject(new Error('an object is written once'));
    }
    this.files.set(key, { bytes: new Uint8Array(bytes), mime });
    return Promise.resolve();
  }

  get(key: string): Promise<StoredFile | undefined> {
    const file = this.files.get(key);
    return Promise.resolve(file === undefined ? undefined : { bytes: new Uint8Array(file.bytes), mime: file.mime });
  }

  signedUrl(key: string, ttlSeconds: number, now: Date): Promise<SignedUrl> {
    if (!this.files.has(key)) return Promise.reject(new Error('no such object'));
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) return Promise.reject(new RangeError('ttl must be a positive number of seconds'));
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    return Promise.resolve({ url: `mock://documents/${encodeURIComponent(key)}?expires=${Math.floor(expiresAt.getTime() / 1000)}`, expiresAt });
  }
}
