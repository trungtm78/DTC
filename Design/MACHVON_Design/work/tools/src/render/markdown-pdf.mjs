import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { escapeHtml } from './html.mjs';
import { translate } from '../i18n.mjs';

// Print styling mirrors the previous ReportLab output: A4, Arial, navy title, ruby headings.
const PRINT_STYLE = [
  '@page{size:A4;margin:15mm 17mm 18mm 17mm}',
  'body{font:10pt/1.45 Arial,sans-serif;color:#29272d}',
  'h1{font-size:22pt;line-height:1.25;color:#142f3c;margin:0 0 6mm}',
  'h2,h3{font-size:13pt;color:#a11d37;margin:6mm 0 2mm;break-after:avoid}',
  'p,li{margin:0 0 2.5mm}',
  'table{border-collapse:collapse;width:100%;margin:2mm 0 4mm;font-size:8.5pt}',
  'td,th{border:1px solid #e5dfe1;padding:1.5mm;vertical-align:top;text-align:left}',
  'th{background:#f6eef0}',
  'tr{break-inside:avoid}',
  'code{font-size:8.5pt;overflow-wrap:anywhere}',
].join('');

const MARKDOWN_FILE = /^\d{2}_.+\.md$/;

export function markdownToPrintHtml(markdown) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
  const body = marked.parse(markdown, { gfm: true });
  const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_STYLE}</style><body>${body}</body></html>`;
  return { title, html };
}

function footerTemplate(ctx) {
  const label = escapeHtml(translate(ctx.messages, 'pdf.footer', { baseline: ctx.baseline, date: ctx.date }));
  return `<div style="font:7pt Arial;color:#657f86;width:100%;padding:0 17mm;display:flex;justify-content:space-between"><span>${label}</span><span class="pageNumber"></span></div>`;
}

export async function exportPdfs(docsDir, ctx, { launch }) {
  const files = readdirSync(docsDir).filter((name) => MARKDOWN_FILE.test(name)).sort();
  const browser = await launch();
  try {
    const results = [];
    for (const file of files) {
      const { title, html } = markdownToPrintHtml(readFileSync(join(docsDir, file), 'utf8'));
      const pdf = join(docsDir, file.replace(/\.md$/, '.pdf'));
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        await page.pdf({
          path: pdf,
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: footerTemplate(ctx),
          margin: { top: '15mm', right: '17mm', bottom: '18mm', left: '17mm' },
        });
      } finally {
        await page.close();
      }
      results.push({ markdown: file, pdf, title });
    }
    return results;
  } finally {
    await browser.close();
  }
}
