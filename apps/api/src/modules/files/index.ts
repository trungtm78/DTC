import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineModule } from '../module-descriptor';
import { FileService } from './file.service';
import { FsObjectStorage } from './fs-object-storage';
import { MockScanPort } from './mock-scan';

/** Where the MOCK adapter keeps objects when the environment names no folder. */
const DEFAULT_ROOT = join(tmpdir(), 'machvon-objects');

/**
 * FILES, the shared upload pipeline (ST-KERNEL-024). It has no endpoints of its own: DOC, SAS and PAY take their files
 * through `FileService`. Until the real storage and antivirus adapters exist (S3 compatible and ClamAV inside Vietnam),
 * the MOCK adapters stand in; the presign key is random per process, so a link never outlives the process.
 */
export const filesModule = defineModule({
  code: 'FILES',
  controllers: [],
  providers: [
    {
      provide: FileService,
      useFactory: () =>
        new FileService({
          storage: new FsObjectStorage(process.env.MACHVON_OBJECT_ROOT ?? DEFAULT_ROOT),
          scanner: new MockScanPort(),
          urlSecret: randomBytes(32),
        }),
    },
  ],
});

export { FileService } from './file.service';
