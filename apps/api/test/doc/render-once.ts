// Renders the sample request once and prints the SHA-256 of the bytes: the determinism test runs it with another TZ and locale.
import { PdfLibRenderer } from '../../src/modules/doc/pdf-renderer.ts';
import { sampleRequest } from './render-fixture.ts';

async function main(): Promise<void> {
  const rendered = await new PdfLibRenderer().render(sampleRequest({ extraParagraphs: 12, watermarkText: 'DRAFT' }));
  process.stdout.write(`${rendered.sha256}\n`);
}

void main();
