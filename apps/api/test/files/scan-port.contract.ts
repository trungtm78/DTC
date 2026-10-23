import type { ScanPort } from '@machvon/kernel';
import { eicarBytes } from '../../src/modules/files/mock-scan';

/** What every adapter of the scan port must do: report the EICAR test file as infected, ordinary content as clean, and nothing else. */
export function scanPortContract(name: string, create: () => ScanPort): void {
  describe(`scan port contract: ${name}`, () => {
    const scanner = create();
    const text = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'utf8'));

    it('reports the EICAR test file as infected', async () => {
      expect(await scanner.scan(eicarBytes())).toBe('INFECTED');
    });

    it('reports the EICAR test string inside a larger file as infected', async () => {
      const wrapped = Uint8Array.from([...text('%PDF-1.7\n'), ...eicarBytes(), ...text('\n%EOF')]);
      expect(await scanner.scan(wrapped)).toBe('INFECTED');
    });

    it('reports ordinary content, an empty file and a near miss as clean', async () => {
      expect(await scanner.scan(text('%PDF-1.7 an ordinary document'))).toBe('CLEAN');
      expect(await scanner.scan(new Uint8Array())).toBe('CLEAN');
      expect(await scanner.scan(eicarBytes().slice(0, 40))).toBe('CLEAN');
    });
  });
}
