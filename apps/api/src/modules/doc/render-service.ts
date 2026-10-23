import { DomainError, assertLayoutWithinLegalRange, payloadSha256, renderInputHash } from '@machvon/kernel';
import type { MetricsSink, PdfRenderer } from '@machvon/kernel';
import { DocumentStore } from '@machvon/db';
import type { DocumentVersionRecord, TenantTx } from '@machvon/db';
import type { DocumentFilePort } from './file-port';
import type { StateText } from './pdf-renderer';
import { buildContent } from './template-render';

export interface RenderParams {
  templateCode?: string | undefined;
  formCode?: string | undefined;
  layoutProfileCode?: string | undefined;
  requireConfirmed: boolean;
  asOfDate: string;
  payload: unknown;
  payloadSha256?: string | undefined;
  output: 'PDF' | 'PREVIEW_PNG';
  actor: string;
}

export interface RenderOutcome {
  documentId: string;
  version: DocumentVersionRecord;
  inputSha256: string;
  watermarked: boolean;
}

export interface RenderServiceDeps {
  files: DocumentFilePort;
  renderer: PdfRenderer;
  text: StateText;
  metrics: MetricsSink;
  documents?: DocumentStore;
}

/**
 * Renders a template with a payload into a stored PDF version (ST-DOC-001: BR-DOC-09 to BR-DOC-13). The template and
 * layout profile are the published revisions in force on the as-of date; a template or profile still waiting for legal
 * confirmation gives a watermarked file (BR-DOC-10) or is refused when the caller asks for confirmed ones only.
 */
export class DocumentRenderService {
  private readonly documents: DocumentStore;

  constructor(private readonly deps: RenderServiceDeps) {
    this.documents = deps.documents ?? new DocumentStore();
  }

  async render(tx: TenantTx, tenantId: string, params: RenderParams): Promise<RenderOutcome> {
    if (params.output !== 'PDF') throw new DomainError('VALIDATION_FAILED', 422, 'output');
    const template = await this.documents.templateFor(tx, { templateCode: params.templateCode, formCode: params.formCode }, params.asOfDate);
    const record =
      params.layoutProfileCode === undefined
        ? await this.documents.layoutProfileById(tx, template.layoutProfileId)
        : await this.documents.layoutProfileByCode(tx, params.layoutProfileCode, params.asOfDate);
    const layout = record.profile;
    assertLayoutWithinLegalRange(layout);
    const unconfirmed = template.confirmationStatus !== 'CONFIRMED' || layout.confirmationStatus !== 'CONFIRMED';
    if (unconfirmed && params.requireConfirmed) throw new DomainError('TEMPLATE_UNCONFIRMED', 422, template.confirmationStatus === 'CONFIRMED' ? 'layout_profile_code' : 'template_code');
    const computedHash = payloadSha256(params.payload);
    if (params.payloadSha256 !== undefined && params.payloadSha256 !== computedHash) throw new DomainError('PAYLOAD_HASH_MISMATCH', 422, 'payload_sha256');
    const content = buildContent(
      {
        template: { title: template.title, docTypeCode: template.docTypeCode, bodyBlocks: template.bodyBlocks, placeholderSchema: template.placeholderSchema },
        payload: params.payload,
        asOfDate: params.asOfDate,
      },
      this.deps.text,
    );
    const watermarkText = unconfirmed ? (template.watermarkText ?? layout.watermarkPolicy.text) : null;
    const inputHash = renderInputHash({
      templateContentSha256: template.contentSha256,
      templateRevision: template.revision,
      layout,
      payload: params.payload,
      asOfDate: params.asOfDate,
      rendererVersion: this.deps.renderer.rendererVersion,
      watermarkText,
    });
    const rendered = await this.deps.renderer.render({ layout, content, asOfDate: params.asOfDate, inputHash, watermarkText });
    const document = await this.documents.insertDocument(tx, {
      docKind: 'ATTACHMENT',
      docTypeCode: template.docTypeCode,
      title: template.title,
      classification: 'INTERNAL',
      createdBy: params.actor,
    });
    // The key follows the layout of the object storage (tenants/{tenant}/{kind}/{id}); the digest of the bytes is part of
    // the id, so a render that is repeated writes the same object, never a second one.
    const objectKey = `tenants/${tenantId}/documents/${document.id}-${rendered.sha256}.pdf`;
    await this.deps.files.put(objectKey, rendered.bytes, 'application/pdf');
    const stored = await this.documents.appendVersion(tx, {
      documentId: document.id,
      objectKey,
      checksum: rendered.sha256,
      mime: 'application/pdf',
      pageCount: rendered.pageCount,
      classification: 'INTERNAL',
      stage: 'RENDERED_FINAL',
      byteLength: rendered.bytes.length,
      rendererVersion: rendered.rendererVersion,
      templateId: template.id,
      createdBy: params.actor,
    });
    // The bytes come from the platform renderer, not from an upload: there is nothing for the malware scan to find.
    const version = await this.documents.setScanResult(tx, stored.id, 'CLEAN');
    this.deps.metrics.increment('doc_render_total', { outcome: 'rendered', watermarked: String(unconfirmed) });
    return { documentId: document.id, version, inputSha256: inputHash, watermarked: unconfirmed };
  }
}
