import type { ScanPort, ScanVerdict } from '@machvon/kernel';

// The standard EICAR antivirus test string, assembled from parts so that this source file is not itself flagged by the
// antivirus of a developer machine. It is harmless: it exists to exercise scanners.
const EICAR_PARTS = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!', '$H+H*'];

/** The EICAR test file as bytes: what every real scanner must report as infected. */
export function eicarBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(EICAR_PARTS.join(''), 'latin1'));
}

/** MOCK adapter of the scan port: it reports a file as infected when it contains the EICAR test string, and nothing else. */
export class MockScanPort implements ScanPort {
  readonly scanned: number[] = [];

  scan(bytes: Uint8Array): Promise<ScanVerdict> {
    this.scanned.push(bytes.length);
    return Promise.resolve(Buffer.from(bytes).includes(Buffer.from(eicarBytes())) ? 'INFECTED' : 'CLEAN');
  }
}
