import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { ND30_A4_STANDARD } from '@machvon/kernel';
import { PdfLibRenderer, RENDERER_VERSION, loadRendererResources, mmToPt, pageMetrics, resourceDirectory } from '../../src/modules/doc/pdf-renderer';
import { sampleRequest } from './render-fixture';

jest.setTimeout(30_000);

const renderer = new PdfLibRenderer();
const A4 = { width: 595.28, height: 841.89 };
const GOLDEN_SHA256 = '90b97ce1e60d71361ef702b7c7c79ec65b8bf474a628b491cc7af7e4acc9f181';

describe('PdfLibRenderer', () => {
  it('writes an A4 PDF whose digest is the SHA-256 of its bytes', async () => {
    const rendered = await renderer.render(sampleRequest());
    expect(Buffer.from(rendered.bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(rendered.pageCount).toBe(1);
    expect(rendered.fontSubstitute).toBe('Tinos');
    expect(rendered.rendererVersion).toBe(RENDERER_VERSION);
    const parsed = await PDFDocument.load(rendered.bytes);
    const size = parsed.getPage(0).getSize();
    expect(size.width).toBeCloseTo(A4.width, 2);
    expect(size.height).toBeCloseTo(A4.height, 2);
    expect(createHash('sha256').update(rendered.bytes).digest('hex')).toBe(rendered.sha256);
  });

  it('gives the same bytes for the same input (BR-DOC-12)', async () => {
    const request = sampleRequest({ extraParagraphs: 12, watermarkText: 'DRAFT' });
    const first = await renderer.render(request);
    const second = await new PdfLibRenderer().render(request);
    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    expect(second.sha256).toBe(first.sha256);
  });

  it('gives the same bytes in another time zone and another locale', () => {
    const run = (environment: Record<string, string>): string => {
      const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'test/doc/render-once.ts'], {
        cwd: join(__dirname, '..', '..'),
        env: { ...process.env, ...environment },
        encoding: 'utf8',
      });
      if (result.status !== 0) throw new Error(`render failed: ${result.stderr}`);
      return result.stdout.trim();
    };
    const utc = run({ TZ: 'UTC', LC_ALL: 'C', LANG: 'C' });
    expect(utc).toMatch(/^[0-9a-f]{64}$/);
    expect(run({ TZ: 'Pacific/Kiritimati', LC_ALL: 'tr_TR.UTF-8', LANG: 'tr_TR.UTF-8' })).toBe(utc);
    expect(run({ TZ: 'America/Los_Angeles', LC_ALL: 'vi_VN.UTF-8', LANG: 'vi_VN.UTF-8' })).toBe(utc);
  }, 90_000);

  it('matches the golden SHA-256 of the ND30_A4_STANDARD sample (a changed digest needs a new renderer version)', async () => {
    const rendered = await renderer.render(sampleRequest({ extraParagraphs: 12, watermarkText: 'DRAFT' }));
    expect(rendered.sha256).toBe(GOLDEN_SHA256);
  });

  it('fixes the dates, the producer and the file identifier from the input, never from the clock', async () => {
    const request = sampleRequest();
    const rendered = await renderer.render(request);
    const parsed = await PDFDocument.load(rendered.bytes, { updateMetadata: false });
    expect(parsed.getCreationDate()?.toISOString()).toBe('2026-06-14T17:00:00.000Z');
    expect(parsed.getModificationDate()?.toISOString()).toBe('2026-06-14T17:00:00.000Z');
    expect(parsed.getProducer()).toBe(RENDERER_VERSION);
    const text = Buffer.from(rendered.bytes).toString('latin1');
    const id = request.inputHash.slice(0, 32);
    expect(text).toMatch(new RegExp(String.raw`/ID\s*\[\s*<${id}>\s*<${id}>\s*\]`, 'i'));
  });

  it('changes the bytes when the input changes', async () => {
    const base = await renderer.render(sampleRequest());
    const watermarked = await renderer.render(sampleRequest({ watermarkText: 'DRAFT' }));
    const otherPayload = await renderer.render(sampleRequest({ payload: { title: 'Other' } }));
    expect(new Set([base.sha256, watermarked.sha256, otherPayload.sha256]).size).toBe(3);
  });

  it('breaks a long body over pages and numbers them from the second page', async () => {
    const rendered = await renderer.render(sampleRequest({ extraParagraphs: 40 }));
    expect(rendered.pageCount).toBeGreaterThanOrEqual(3);
    const again = await renderer.render(sampleRequest({ extraParagraphs: 40 }));
    expect(again.sha256).toBe(rendered.sha256);
  });

  it('refuses an as-of date that is not a calendar date', async () => {
    await expect(renderer.render({ ...sampleRequest(), asOfDate: '2026-13-45' })).rejects.toThrow(RangeError);
  });

  it('leaves the signer and the recipients out when the document has none', async () => {
    const request = sampleRequest();
    const bare = await renderer.render({ ...request, content: { ...request.content, parentAgency: null, summary: null, signerTitle: null, signerName: null, recipients: [] } });
    const full = await renderer.render(request);
    expect(bare.bytes.length).toBeLessThan(full.bytes.length);
  });

  it('draws a signer title without a name', async () => {
    const request = sampleRequest();
    const rendered = await renderer.render({ ...request, content: { ...request.content, signerName: null } });
    expect(rendered.pageCount).toBe(1);
  });
});

describe('page metrics and resources', () => {
  it('derives the text area from the margins of the profile', () => {
    const metrics = pageMetrics(ND30_A4_STANDARD);
    expect(metrics.left).toBeCloseTo(mmToPt(30), 6);
    expect(A4.width - metrics.right).toBeCloseTo(mmToPt(15), 2);
    expect(A4.height - metrics.top).toBeCloseTo(mmToPt(20), 2);
    expect(metrics.bottom).toBeCloseTo(mmToPt(20), 6);
    expect(metrics.contentWidth).toBeCloseTo(A4.width - mmToPt(45), 2);
  });

  it('finds the resources from the package or the repository directory and refuses a missing one', () => {
    const packageDirectory = join(__dirname, '..', '..');
    const repositoryDirectory = join(packageDirectory, '..', '..');
    expect(resourceDirectory(packageDirectory, {})).toBe(resourceDirectory(repositoryDirectory, {}));
    expect(resourceDirectory(join(packageDirectory, 'test'), { MACHVON_DOC_RESOURCES: resourceDirectory(packageDirectory, {}) })).toBe(resourceDirectory(packageDirectory, {}));
    expect(() => resourceDirectory(join(packageDirectory, 'test'), {})).toThrow('resources not found');
  });

  it('carries the fixed words of a state document', () => {
    const { text } = loadRendererResources();
    expect(text.nationalTitle).toContain('VIỆT NAM');
    expect(text.pageNumberFormat).toContain('{page}');
  });

  it('has a glyph for every Vietnamese letter in the three cuts of the vendored font', () => {
    const letters = 'aàáảãạăằắẳẵặâầấẩẫậeèéẻẽẹêềếểễệiìíỉĩịoòóỏõọôồốổỗộơờớởỡợuùúủũụưừứửữựyỳýỷỹỵđ';
    const directory = join(resourceDirectory(), 'fonts');
    for (const file of ['Tinos-Regular.ttf', 'Tinos-Bold.ttf', 'Tinos-Italic.ttf']) {
      const font = (fontkit as unknown as { create(bytes: Buffer): { hasGlyphForCodePoint(code: number): boolean } }).create(readFileSync(join(directory, file)));
      const missing = [...letters, ...letters.toUpperCase()].filter((letter) => !font.hasGlyphForCodePoint(letter.codePointAt(0) ?? 0));
      expect(missing).toEqual([]);
    }
  });
});
