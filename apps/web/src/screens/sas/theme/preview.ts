import { THEME_COLOR_KEYS, TOKENS } from '@machvon/design-tokens';
import type { ThemeColorKey } from '@machvon/design-tokens';
import type { ThemeConfig } from './types';

/** The words of the sample page the preview shows (the screen translates them; the preview document has no catalogue). */
export const PREVIEW_TEXT_KEYS = ['overview', 'projects', 'disbursement', 'notifications', 'metricLabel', 'metricUnit', 'metricStatus', 'action', 'note'] as const;
export type PreviewText = Readonly<Record<(typeof PREVIEW_TEXT_KEYS)[number], string>>;

export type PreviewMode = 'web' | 'phone';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MARK_LETTERS = 2;

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// Only #rrggbb gets into the style; whatever else the draft holds shows the base colour, so a draft can never inject CSS.
function colour(config: ThemeConfig, key: ThemeColorKey): string {
  const value = config[key];
  return HEX_COLOR.test(value) ? value : TOKENS.tenantTheme[key];
}

/**
 * The document the preview frame shows: a small page in the colours and texts of the theme. It is a separate document in
 * a sandboxed frame without any permission, so nothing of it (style, script, form) can reach the application, and the
 * application's own stylesheet cannot reach it. The sample words come from the screen's catalogue.
 */
export function previewDocument(config: ThemeConfig, mode: PreviewMode, text: PreviewText, language: string): string {
  const c = Object.fromEntries(THEME_COLOR_KEYS.map((key) => [key, colour(config, key)])) as Record<ThemeColorKey, string>;
  const phone = mode === 'phone';
  const mark = escapeHtml(Array.from(config.name.trim()).slice(0, MARK_LETTERS).join('').toUpperCase());
  const contact = escapeHtml([config.email, config.phone].filter((part) => part !== '').join(' · '));
  const style = [
    '*{box-sizing:border-box}',
    `body{margin:0;font:13px/1.5 Segoe UI,Arial;color:#343039;background:${c.background}}`,
    `header{padding:15px;background:${c.headerBg};color:${c.headerText};display:flex;gap:10px;align-items:center;border-bottom:1px solid #ddd}`,
    'header strong{font-size:13px}header small{display:block}',
    `.shell{display:grid;grid-template-columns:${phone ? '1fr' : '140px 1fr'};min-height:320px}`,
    `nav{background:${c.menu};color:${c.menuText};padding:15px 9px;${phone ? 'display:flex;gap:7px;order:2;flex-wrap:wrap' : ''}}`,
    'nav div{padding:10px 8px;border-radius:6px;margin-bottom:5px}',
    `nav .on{background:${c.selected};color:${c.selectedText};font-weight:600}`,
    'main{padding:22px;min-width:0}',
    `h1{color:${c.titleColor};font-size:23px;line-height:1.3;margin:0 0 10px}`,
    '.card{background:white;border:1px solid #e8e3e5;border-radius:9px;padding:17px;margin:17px 0}',
    '.metric{font-size:30px;font-weight:650}',
    `.cta{display:inline-block;padding:10px 15px;background:${c.primary};color:${c.primaryText};border-radius:7px;font-weight:600}`,
    '.sub{color:#68616c;font-size:12px}',
    '.status{background:#edf6ef;color:#27684e;padding:4px 7px;border-radius:4px;font-size:11px}',
    `footer{background:${c.footerBg};color:${c.footerText};padding:16px;font-size:11px;border-top:1px solid #ddd}footer p{margin:3px 0}`,
    `.brand{background:${c.primary};color:${c.primaryText};padding:8px;border-radius:8px}`,
    'p{overflow-wrap:anywhere}',
  ].join('');
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(language)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<style>${style}</style>`,
    `<header><span class="brand">${mark}</span><div><strong>${escapeHtml(config.header)}</strong><small>${escapeHtml(config.name)}</small></div></header>`,
    `<div class="shell"><nav><div class="on">${escapeHtml(text.overview)}</div><div>${escapeHtml(text.projects)}</div><div>${escapeHtml(text.disbursement)}</div><div>${escapeHtml(text.notifications)}</div></nav>`,
    `<main><h1>${escapeHtml(config.title)}</h1><p class="sub">${escapeHtml(config.subtitle)}</p>`,
    `<div class="card"><span class="sub">${escapeHtml(text.metricLabel)}</span><div class="metric">214,71 <small style="font-size:12px">${escapeHtml(text.metricUnit)}</small></div><span class="status">${escapeHtml(text.metricStatus)}</span></div>`,
    `<span class="cta">${escapeHtml(text.action)}</span><p class="sub">${escapeHtml(text.note)}</p></main></div>`,
    `<footer><p>${escapeHtml(config.footer)}</p><p>${escapeHtml(config.address)}</p><p>${contact}</p></footer></html>`,
  ].join('');
}
