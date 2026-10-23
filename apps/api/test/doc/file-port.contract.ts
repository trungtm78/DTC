import type { DocumentFilePort } from '../../src/modules/doc/file-port';

const NOW = new Date('2026-10-23T03:00:00Z');
const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'));

/**
 * The contract every adapter of the document file port must meet (BR-DOC-16, BR-DOC-19): an object is written once,
 * reads give back exactly what was written, and a signed URL lives for the time asked and only for an object that exists.
 */
export function runDocumentFilePortContract(name: string, create: () => DocumentFilePort | Promise<DocumentFilePort>): void {
  describe(`document file port contract: ${name}`, () => {
    it('gives back the bytes and the mime type that were stored', async () => {
      const port = await create();
      await port.put('t/a/doc/1.pdf', bytes('%PDF-one'), 'application/pdf');
      const file = await port.get('t/a/doc/1.pdf');
      expect(Buffer.from(file?.bytes ?? []).toString('utf8')).toBe('%PDF-one');
      expect(file?.mime).toBe('application/pdf');
    });

    it('answers undefined for a key that holds nothing', async () => {
      expect(await (await create()).get('t/a/doc/missing.pdf')).toBeUndefined();
    });

    it('accepts the same bytes under the same key again and refuses other bytes', async () => {
      const port = await create();
      await port.put('t/a/doc/2.pdf', bytes('first'), 'application/pdf');
      await expect(port.put('t/a/doc/2.pdf', bytes('first'), 'application/pdf')).resolves.toBeUndefined();
      await expect(port.put('t/a/doc/2.pdf', bytes('second'), 'application/pdf')).rejects.toThrow();
      expect(Buffer.from((await port.get('t/a/doc/2.pdf'))?.bytes ?? []).toString('utf8')).toBe('first');
    });

    it('does not let a caller change a stored object through the array it passed or received', async () => {
      const port = await create();
      const original = bytes('immutable');
      await port.put('t/a/doc/3.pdf', original, 'application/pdf');
      original[0] = 0;
      const first = await port.get('t/a/doc/3.pdf');
      if (first === undefined) throw new Error('missing');
      first.bytes[0] = 0;
      expect(Buffer.from((await port.get('t/a/doc/3.pdf'))?.bytes ?? []).toString('utf8')).toBe('immutable');
    });

    it('signs a URL that expires after the time asked', async () => {
      const port = await create();
      await port.put('t/a/doc/4.pdf', bytes('x'), 'application/pdf');
      const signed = await port.signedUrl('t/a/doc/4.pdf', 300, NOW);
      expect(signed.expiresAt.toISOString()).toBe('2026-10-23T03:05:00.000Z');
      expect(signed.url.length).toBeGreaterThan(0);
      const shorter = await port.signedUrl('t/a/doc/4.pdf', 60, NOW);
      expect(shorter.expiresAt.getTime()).toBe(NOW.getTime() + 60_000);
      expect(shorter.url).not.toBe(signed.url);
    });

    it('refuses to sign a URL for an object that does not exist or for a ttl that is not positive', async () => {
      const port = await create();
      await expect(port.signedUrl('t/a/doc/none.pdf', 300, NOW)).rejects.toThrow();
      await port.put('t/a/doc/5.pdf', bytes('x'), 'application/pdf');
      await expect(port.signedUrl('t/a/doc/5.pdf', 0, NOW)).rejects.toThrow();
    });
  });
}
