import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { ND30_A4_STANDARD } from '@machvon/kernel';
import { PdfLibRenderer, mmToPt, resourceDirectory } from '../../src/modules/doc/pdf-renderer';
import { sampleContent, sampleRequest } from './render-fixture';
import { textRuns } from './support/pdf-text';

jest.setTimeout(30_000);

const renderer = new PdfLibRenderer();
const A4_WIDTH = 595.28;
const LONG_PLACE_DATE = 'Thành phố Hồ Chí Minh, ngày 15 tháng 6 năm 2026';

interface MeasuringFont {
  layout(text: string): { advanceWidth: number };
  unitsPerEm: number;
}

function measure(file: string, text: string, size: number): number {
  const font = (fontkit as unknown as { create(bytes: Buffer): MeasuringFont }).create(readFileSync(join(resourceDirectory(), 'fonts', file)));
  return (font.layout(text).advanceWidth / font.unitsPerEm) * size;
}

describe('the place and date line', () => {
  const box = ND30_A4_STANDARD.numberFieldLayout.date;
  const dateLines = async (placeDate: string) => {
    const request = sampleRequest();
    const rendered = await renderer.render({ ...request, content: { ...request.content, placeDate } });
    return (await textRuns(rendered.bytes)).filter((run) => Math.abs(run.x - mmToPt(box.xMm)) < 0.01 && run.size === 14);
  };

  it('stays inside the width of its box and the page, wrapped over lines when the place is long', async () => {
    const lines = await dateLines(LONG_PLACE_DATE);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join(' ')).toBe(LONG_PLACE_DATE);
    for (const line of lines) {
      expect(measure('Tinos-Italic.ttf', line.text, line.size)).toBeLessThanOrEqual(mmToPt(box.widthMm));
      expect(line.x + measure('Tinos-Italic.ttf', line.text, line.size)).toBeLessThanOrEqual(A4_WIDTH - mmToPt(ND30_A4_STANDARD.marginsMm.right));
    }
    // The lines go down the page, one line height apart.
    expect(lines.every((line, index) => index === 0 || line.y < (lines[index - 1]?.y ?? 0))).toBe(true);
  });

  it('keeps a short line on one line', async () => {
    expect((await dateLines('Cao Bằng, ngày 1')).length).toBe(1);
  });

  it('pushes the document body down by the lines it took', async () => {
    const request = sampleRequest();
    const firstBodyY = async (placeDate: string): Promise<number> => {
      const rendered = await renderer.render({ ...request, content: { ...request.content, placeDate } });
      const runs = await textRuns(rendered.bytes);
      const body = runs.find((run) => run.text.startsWith('Căn cứ pháp lý'));
      if (body === undefined) throw new Error('no body');
      return body.y;
    };
    expect(await firstBodyY(LONG_PLACE_DATE)).toBeLessThanOrEqual(await firstBodyY('Cao Bằng, ngày 1'));
  });
});

describe('a long list of recipients', () => {
  it('breaks over pages and leaves none out or below the bottom margin', async () => {
    const recipients = Array.from({ length: 70 }, (_, index) => `Recipient number ${index + 1};`);
    const request = sampleRequest();
    const rendered = await renderer.render({ ...request, content: { ...sampleContent(), recipients } });
    expect(rendered.pageCount).toBeGreaterThan(1);
    const runs = (await textRuns(rendered.bytes)).filter((run) => run.text.startsWith('- Recipient number'));
    expect(runs.map((run) => run.text)).toEqual(recipients.map((recipient) => `- ${recipient}`));
    for (const run of runs) expect(run.y).toBeGreaterThanOrEqual(mmToPt(ND30_A4_STANDARD.marginsMm.bottom));
    expect(new Set(runs.map((run) => run.page)).size).toBeGreaterThan(1);
  });

  it('keeps the signer block next to the label on the first page of the footer', async () => {
    const recipients = Array.from({ length: 70 }, (_, index) => `Recipient number ${index + 1};`);
    const request = sampleRequest();
    const rendered = await renderer.render({ ...request, content: { ...sampleContent(), recipients } });
    const runs = await textRuns(rendered.bytes);
    const label = runs.find((run) => run.text === 'Nơi nhận:');
    const signer = runs.find((run) => run.text === 'Nguyễn Minh An');
    expect(label?.page).toBe(signer?.page);
  });
});

describe('the signable rendering', () => {
  it('leaves the number and the date regions empty, whatever the content says (the numbering revision fills the fields)', async () => {
    const request = { ...sampleRequest(), signatureFields: true };
    const other = { ...request, content: { ...request.content, numberText: 'Số: 99/XX-YY', placeDate: 'Hà Nội, ngày 1 tháng 1 năm 2030' } };
    const left = await renderer.render(request);
    const right = await renderer.render(other);
    expect(Buffer.from(right.bytes).equals(Buffer.from(left.bytes))).toBe(true);
    const texts = (await textRuns(left.bytes)).map((run) => run.text).join('\n');
    expect(texts).not.toContain('05/QĐ-UBND');
    expect(texts).not.toContain('Cao Bằng');
  });

  it('draws that text in a rendering without the form', async () => {
    const request = sampleRequest();
    const texts = (await textRuns((await renderer.render(request)).bytes)).map((run) => run.text).join('\n');
    expect(texts).toContain('Số: 05/QĐ-UBND');
    expect(texts).toContain('Cao Bằng');
  });
});
