import { MockDocumentFilePort } from '../../src/modules/doc/file-port';
import { runDocumentFilePortContract } from './file-port.contract';

runDocumentFilePortContract('MOCK', () => new MockDocumentFilePort());
