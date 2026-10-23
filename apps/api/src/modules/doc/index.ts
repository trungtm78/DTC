import { defineModule } from '../module-descriptor';
import { DocumentVersionReadsController, DocumentsController } from './documents.controller';
import { DOCUMENT_FILE_PORT, MockDocumentFilePort } from './file-port';
import { PdfLibRenderer, loadRendererResources } from './pdf-renderer';
import type { RendererResources } from './pdf-renderer';
import { RegistersController } from './registers.controller';
import { DOC_RESOURCES, DOC_STATE_TEXT, PDF_RENDERER } from './tokens';

/**
 * DOC, documents: the anchor and file versions, deterministic PDF rendering, document types and number registers
 * (ST-DOC-001, ST-DOC-002). The signing, outgoing and incoming flows join it in later slices.
 */
export const docModule = defineModule({
  code: 'DOC',
  controllers: [DocumentsController, DocumentVersionReadsController, RegistersController],
  providers: [
    // The object storage of the platform replaces the in-memory adapter when it is bound (KERNEL-024).
    { provide: DOCUMENT_FILE_PORT, useValue: new MockDocumentFilePort() },
    // Fonts and fixed texts are read when the application starts, not when this file is imported.
    { provide: DOC_RESOURCES, useFactory: (): RendererResources => loadRendererResources() },
    { provide: PDF_RENDERER, useFactory: (resources: RendererResources): PdfLibRenderer => new PdfLibRenderer(resources), inject: [DOC_RESOURCES] },
    { provide: DOC_STATE_TEXT, useFactory: (resources: RendererResources) => resources.text, inject: [DOC_RESOURCES] },
  ],
});
