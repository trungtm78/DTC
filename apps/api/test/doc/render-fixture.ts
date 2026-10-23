import { ND30_A4_STANDARD, renderInputHash } from '@machvon/kernel';
import type { RenderContent, RenderRequest } from '@machvon/kernel';

export const AS_OF_DATE = '2026-06-15';
const TEMPLATE_SHA = 'a'.repeat(64);

export function sampleContent(extraParagraphs = 0): RenderContent {
  const body = Array.from({ length: extraParagraphs }, (_, index) => ({
    kind: 'paragraph' as const,
    text: `Điều ${index + 1}. Giao Ban Quản lý dự án chủ trì, phối hợp với các sở, ngành có liên quan tổ chức thực hiện đúng tiến độ, bảo đảm chất lượng công trình và quy định của pháp luật về đầu tư công.`,
  }));
  return {
    parentAgency: 'ỦY BAN NHÂN DÂN TỈNH CAO BẰNG',
    agency: 'BAN QUẢN LÝ DỰ ÁN',
    docTypeName: 'QUYẾT ĐỊNH',
    numberText: 'Số: 05/QĐ-UBND',
    placeDate: 'Cao Bằng, ngày 15 tháng 6 năm 2026',
    summary: 'Về việc phê duyệt kế hoạch giải ngân vốn đầu tư công năm 2026',
    blocks: [
      { kind: 'heading', text: 'Căn cứ pháp lý' },
      { kind: 'paragraph', text: 'Căn cứ Luật Đầu tư công; Căn cứ Nghị định số 30/2020/NĐ-CP ngày 05 tháng 3 năm 2020.' },
      ...body,
    ],
    signerTitle: 'Giám đốc',
    signerName: 'Nguyễn Minh An',
    recipients: ['Như Điều 3;', 'Lưu: VT, KHTC.'],
  };
}

export function sampleRequest(overrides: { extraParagraphs?: number; watermarkText?: string | null; payload?: unknown } = {}): RenderRequest {
  const content = sampleContent(overrides.extraParagraphs);
  const watermarkText = overrides.watermarkText === undefined ? null : overrides.watermarkText;
  const inputHash = renderInputHash({
    templateContentSha256: TEMPLATE_SHA,
    templateRevision: 1,
    layout: ND30_A4_STANDARD,
    payload: overrides.payload ?? { title: 'Quyết định', amount: 1234567.5 },
    asOfDate: AS_OF_DATE,
    rendererVersion: 'test',
    watermarkText,
  });
  return { layout: ND30_A4_STANDARD, content, asOfDate: AS_OF_DATE, inputHash, watermarkText };
}
