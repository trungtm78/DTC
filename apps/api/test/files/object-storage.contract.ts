import { InvalidObjectKeyError, objectKey } from '@machvon/kernel';
import type { ObjectStoragePort, TenantContext } from '@machvon/kernel';

const TENANT_A = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const TENANT_B = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const MEMBER = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

const context = (tenantId: string): TenantContext => ({ tenantId, membershipId: MEMBER, scopeVersion: 1 });
const bytesOf = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'utf8'));

/**
 * What every adapter of the object storage port must do (ST-KERNEL-024). The MOCK file system adapter runs it today; the
 * S3 compatible adapter runs the same suite against a real bucket when it exists.
 */
export function objectStorageContract(name: string, create: () => Promise<{ storage: ObjectStoragePort; cleanup(): Promise<void> }>): void {
  describe(`object storage contract: ${name}`, () => {
    const a = context(TENANT_A);
    const b = context(TENANT_B);
    let storage: ObjectStoragePort;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ storage, cleanup } = await create());
    });

    afterEach(async () => {
      await cleanup();
    });

    it('keeps what was put, as PENDING, with its size, hash and type', async () => {
      const key = objectKey(TENANT_A, 'document', 'one.pdf');
      const put = await storage.put(a, key, bytesOf('hello'), { contentType: 'application/pdf' });
      expect(put).toMatchObject({ key, size: 5, contentType: 'application/pdf', scanStatus: 'PENDING' });
      expect(put.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
      const got = await storage.get(a, key);
      expect(Buffer.from(got?.bytes ?? []).toString('utf8')).toBe('hello');
      expect(got?.object).toEqual(put);
      expect(await storage.head(a, key)).toEqual(put);
    });

    it('answers undefined for an object that does not exist', async () => {
      const key = objectKey(TENANT_A, 'document', 'missing');
      expect(await storage.head(a, key)).toBeUndefined();
      expect(await storage.get(a, key)).toBeUndefined();
      expect(await storage.setScanStatus(a, key, 'CLEAN')).toBeUndefined();
      expect(await storage.remove(a, key)).toBe(false);
    });

    it('treats the object of another tenant exactly as a missing one, and leaves it untouched', async () => {
      const key = objectKey(TENANT_A, 'document', 'secret.pdf');
      const put = await storage.put(a, key, bytesOf('tenant A secret'), { contentType: 'application/pdf' });
      expect(await storage.head(b, key)).toBeUndefined();
      expect(await storage.get(b, key)).toBeUndefined();
      expect(await storage.setScanStatus(b, key, 'CLEAN')).toBeUndefined();
      expect(await storage.remove(b, key)).toBe(false);
      expect(await storage.list(b, 'document')).toEqual([]);
      expect(await storage.head(a, key)).toEqual(put);
      expect(Buffer.from((await storage.get(a, key))?.bytes ?? []).toString('utf8')).toBe('tenant A secret');
    });

    it('refuses to write under a key that is not under the prefix of the tenant, or is not a key at all', async () => {
      const foreign = objectKey(TENANT_B, 'document', 'x');
      await expect(storage.put(a, foreign, bytesOf('x'), { contentType: 'text/plain' })).rejects.toBeInstanceOf(InvalidObjectKeyError);
      for (const bad of ['', '../x', `tenants/${TENANT_A}/document/../../${TENANT_B}/document/x`, `tenants/${TENANT_A}/document`, `tenants/${TENANT_A.toUpperCase()}/document/x`]) {
        await expect(storage.put(a, bad, bytesOf('x'), { contentType: 'text/plain' })).rejects.toBeInstanceOf(InvalidObjectKeyError);
        expect(await storage.head(a, bad)).toBeUndefined();
      }
      expect(await storage.list(b, 'document')).toEqual([]);
      expect(await storage.list(a, 'document')).toEqual([]);
    });

    it('moves the scan status from PENDING to a final verdict once', async () => {
      const key = objectKey(TENANT_A, 'document', 'scan.pdf');
      await storage.put(a, key, bytesOf('x'), { contentType: 'application/pdf' });
      expect((await storage.setScanStatus(a, key, 'INFECTED'))?.scanStatus).toBe('INFECTED');
      await expect(storage.setScanStatus(a, key, 'CLEAN')).rejects.toThrow(/scan/);
      expect((await storage.head(a, key))?.scanStatus).toBe('INFECTED');
    });

    it('starts the scan again when new content replaces the object', async () => {
      const key = objectKey(TENANT_A, 'document', 'again.pdf');
      await storage.put(a, key, bytesOf('first'), { contentType: 'application/pdf' });
      await storage.setScanStatus(a, key, 'CLEAN');
      const second = await storage.put(a, key, bytesOf('second'), { contentType: 'application/pdf' });
      expect(second.scanStatus).toBe('PENDING');
      expect(Buffer.from((await storage.get(a, key))?.bytes ?? []).toString('utf8')).toBe('second');
    });

    it('applies a scan verdict only to the content that was scanned: a replaced object stays PENDING', async () => {
      const key = objectKey(TENANT_A, 'document', 'bound.pdf');
      const first = await storage.put(a, key, bytesOf('first'), { contentType: 'application/pdf' });
      const second = await storage.put(a, key, bytesOf('second'), { contentType: 'application/pdf' });
      const stale = await storage.setScanStatus(a, key, 'CLEAN', first.sha256);
      expect(stale).toEqual(second);
      expect((await storage.head(a, key))?.scanStatus).toBe('PENDING');
      const fresh = await storage.setScanStatus(a, key, 'CLEAN', second.sha256);
      expect(fresh).toMatchObject({ sha256: second.sha256, scanStatus: 'CLEAN' });
      // A verdict that names no content still applies to whatever is stored, as before.
      const other = objectKey(TENANT_A, 'document', 'unbound.pdf');
      await storage.put(a, other, bytesOf('x'), { contentType: 'application/pdf' });
      expect((await storage.setScanStatus(a, other, 'CLEAN'))?.scanStatus).toBe('CLEAN');
    });

    it('never shows the bytes of one version with the verdict of another while an object is replaced', async () => {
      const key = objectKey(TENANT_A, 'document', 'swap.pdf');
      const clean = Buffer.alloc(1024 * 1024, 0x61);
      const unscanned = Buffer.alloc(1024 * 1024, 0x62);
      const original = await storage.put(a, key, clean, { contentType: 'application/pdf' });
      await storage.setScanStatus(a, key, 'CLEAN', original.sha256);
      let running = true;
      const readers = Array.from({ length: 3 }, async () => {
        const seen: string[] = [];
        while (running) {
          const got = await storage.get(a, key);
          if (got === undefined) continue;
          // A CLEAN verdict is only ever shown with the bytes it was given for.
          if (got.object.scanStatus === 'CLEAN' && !Buffer.from(got.bytes).equals(clean)) seen.push('unscanned bytes under a CLEAN verdict');
          if (Buffer.from(got.bytes).equals(clean) !== (got.object.sha256 === original.sha256)) seen.push('bytes and description of different versions');
        }
        return seen;
      });
      let seen: string[][] = [];
      try {
        for (let round = 0; round < 10; round += 1) {
          await storage.put(a, key, unscanned, { contentType: 'application/pdf' });
          await storage.put(a, key, clean, { contentType: 'application/pdf' });
          await storage.setScanStatus(a, key, 'CLEAN', original.sha256);
        }
      } finally {
        running = false;
        // The readers are finished before the test ends, whatever happened: nothing may keep writing into the next test's folder.
        seen = await Promise.all(readers);
      }
      expect(seen.flat()).toEqual([]);
    }, 120_000);

    it('keeps ids that differ only in letter case apart, also on a file system that ignores case', async () => {
      const upper = objectKey(TENANT_A, 'document', 'A.pdf');
      const lower = objectKey(TENANT_A, 'document', 'a.pdf');
      await storage.put(a, upper, bytesOf('upper'), { contentType: 'text/plain' });
      await storage.put(a, lower, bytesOf('lower!'), { contentType: 'text/plain' });
      expect(Buffer.from((await storage.get(a, upper))?.bytes ?? []).toString('utf8')).toBe('upper');
      expect(Buffer.from((await storage.get(a, lower))?.bytes ?? []).toString('utf8')).toBe('lower!');
      expect((await storage.list(a, 'document')).map((object) => object.key).sort()).toEqual([upper, lower].sort());
      expect(await storage.remove(a, upper)).toBe(true);
      expect((await storage.head(a, lower))?.size).toBe(6);
      expect(await storage.head(a, upper)).toBeUndefined();
    });

    it('removes an object once', async () => {
      const key = objectKey(TENANT_A, 'document', 'gone.pdf');
      await storage.put(a, key, bytesOf('x'), { contentType: 'application/pdf' });
      expect(await storage.remove(a, key)).toBe(true);
      expect(await storage.remove(a, key)).toBe(false);
      expect(await storage.head(a, key)).toBeUndefined();
      expect(await storage.get(a, key)).toBeUndefined();
    });

    it('lists the objects of one kind of the calling tenant only, sorted by key', async () => {
      for (const id of ['b.pdf', 'a.pdf']) await storage.put(a, objectKey(TENANT_A, 'document', id), bytesOf(id), { contentType: 'application/pdf' });
      await storage.put(a, objectKey(TENANT_A, 'logo', 'l.png'), bytesOf('l'), { contentType: 'image/png' });
      await storage.put(b, objectKey(TENANT_B, 'document', 'other.pdf'), bytesOf('o'), { contentType: 'application/pdf' });
      expect((await storage.list(a, 'document')).map((object) => object.key)).toEqual([objectKey(TENANT_A, 'document', 'a.pdf'), objectKey(TENANT_A, 'document', 'b.pdf')]);
      expect((await storage.list(a, 'logo')).map((object) => object.key)).toEqual([objectKey(TENANT_A, 'logo', 'l.png')]);
      expect((await storage.list(b, 'document')).map((object) => object.key)).toEqual([objectKey(TENANT_B, 'document', 'other.pdf')]);
      expect(await storage.list(a, 'nothing')).toEqual([]);
      expect(await storage.list(a, '../document')).toEqual([]);
    });

    it('keeps ids that look alike apart', async () => {
      const first = objectKey(TENANT_A, 'document', 'a');
      const second = objectKey(TENANT_A, 'document', 'a.json');
      await storage.put(a, first, bytesOf('1'), { contentType: 'text/plain' });
      await storage.put(a, second, bytesOf('22'), { contentType: 'text/plain' });
      expect((await storage.head(a, first))?.size).toBe(1);
      expect((await storage.head(a, second))?.size).toBe(2);
      expect((await storage.list(a, 'document')).map((object) => object.key)).toEqual([first, second]);
    });
  });
}
