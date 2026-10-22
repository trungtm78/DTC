import { translate } from '../i18n.mjs';

// Visual shell shared with the hand-written engineering pages (Ruby / Porcelain palette).
const PAGE_STYLE = [
  'body{max-width:1280px;margin:30px auto;padding:24px;background:#faf8f8;color:#29272d;font:15px/1.6 Segoe UI}',
  'h1,h2,a{color:#a11d37}',
  'table{border-collapse:collapse;width:100%;background:white}',
  'td,th{border:1px solid #e5dfe1;padding:12px;text-align:left;vertical-align:top}',
  'code{overflow-wrap:anywhere}',
  'section{padding:20px;margin:20px 0;background:white;border:1px solid #e5dfe1;border-radius:10px}',
  'input{width:100%;padding:10px;margin:12px 0;border:1px solid #e5dfe1;border-radius:8px;font:inherit}',
].join('');

const FILTER_SCRIPT =
  "document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.innerText.toLowerCase().includes(this.value.toLowerCase()))";

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function renderTable(headers, rows, { filterLabel } = {}) {
  const filter = filterLabel
    ? `<input aria-label="${escapeHtml(filterLabel)}" placeholder="${escapeHtml(filterLabel)}" oninput="${FILTER_SCRIPT}">`
    : '';
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  return `${filter}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderPage({ title, intro = [], body }, ctx) {
  const meta = translate(ctx.messages, 'page.common.meta', { baseline: ctx.baseline, date: ctx.date });
  const back = translate(ctx.messages, 'page.common.back');
  const paragraphs = [meta, ...intro].map((text) => `<p>${escapeHtml(text)}</p>`).join('');
  return [
    '<!doctype html><html lang="vi"><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style>`,
    `<a href="../index.html">${escapeHtml(back)}</a><h1>${escapeHtml(title)}</h1>`,
    paragraphs,
    body,
  ].join('');
}
