import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escapeHtml, renderPage, renderTable } from '../src/render/html.mjs';
import { GENERATED_PAGES, buildPages } from '../src/render/pages.mjs';
import { markdownToPrintHtml, exportPdfs } from '../src/render/markdown-pdf.mjs';
import { loadMessages } from '../src/i18n.mjs';
import { validModel } from './fixtures.mjs';

const ctx = { messages: loadMessages('vi'), baseline: '1.4', date: '22/10/2026' };

function richModel() {
  const model = validModel();
  model.screens[0].title = 'Đăng nhập';
  model.backlog[0] = { ...model.backlog[0], title: 'Đăng nhập', module: 'IAM', phase: 'P0', owner: 'Identity', dependencies: 'Không', status: 'NOT_BUILT', readiness: 'SPEC_REVIEW_REQUIRED' };
  model.decisions = [{ id: 'D01', owner: 'Tech Lead', deadline: 'Trước sprint 1', decision: 'Stack <b>', evidence: 'Spike', status: 'OPEN' }];
  return model;
}

test('escapeHtml neutralises markup characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
});

test('renderTable escapes cells and can add a filter box', () => {
  const html = renderTable(['A', 'B'], [['<x>', 2]], { filterLabel: 'Lọc' });
  assert.match(html, /<th>A<\/th><th>B<\/th>/);
  assert.match(html, /<td>&lt;x&gt;<\/td><td>2<\/td>/);
  assert.match(html, /aria-label="Lọc"/);
  assert.doesNotMatch(renderTable(['A'], [['1']]), /<input/);
});

test('renderPage keeps the design-package shell and back link', () => {
  const html = renderPage({ title: 'T <1>', intro: ['p1'], body: '<table></table>' }, ctx);
  assert.match(html, /^<!doctype html><html lang="vi">/);
  assert.match(html, /<title>T &lt;1&gt;<\/title>/);
  assert.match(html, /href="\.\.\/index\.html"/);
  assert.match(html, /Baseline 1\.4 · 22\/10\/2026/);
  assert.match(html, /<p>p1<\/p>/);
});

test('only catalogue pages are generated; hand-written pages are never overwritten', () => {
  const files = GENERATED_PAGES.map((spec) => spec.file).sort();
  assert.deepEqual(files, [
    'API_Catalogue.html',
    'Data_Dictionary.html',
    'Decision_Register.html',
    'Implementation_Backlog.html',
    'Implementation_Plan.html',
    'Test_Case_Catalogue.html',
    'Traceability.html',
  ]);
});

test('buildPages renders one row per record for every generated page', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'machvon-pages-'));
  const written = buildPages(richModel(), outDir, ctx);
  const expectedFiles = GENERATED_PAGES.filter((s) => s.file !== 'Implementation_Plan.html').map((s) => s.file).sort();
  assert.equal(written.length, expectedFiles.length, 'the plan page needs a loaded plan');
  assert.deepEqual(readdirSync(outDir).sort(), expectedFiles);

  const read = (file) => readFileSync(join(outDir, file), 'utf8');
  const bodyRows = (html) => (html.match(/<tr><td>/g) ?? []).length;
  assert.equal(bodyRows(read('Traceability.html')), 2);
  assert.equal(bodyRows(read('Implementation_Backlog.html')), 2);
  assert.equal(bodyRows(read('Test_Case_Catalogue.html')), 3);
  assert.equal(bodyRows(read('Decision_Register.html')), 1);
  assert.equal(bodyRows(read('API_Catalogue.html')), 2);
  assert.match(read('Decision_Register.html'), /Stack &lt;b&gt;/);
  assert.match(read('Data_Dictionary.html'), /<section id="project">/);
  assert.match(read('Implementation_Backlog.html'), /IAM-01 · Đăng nhập/);
});

test('markdownToPrintHtml renders headings, tables and keeps the document title', () => {
  const md = '# Tài liệu A\nBaseline 1.4\n\n## Mục 1\nĐoạn văn.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  const { title, html } = markdownToPrintHtml(md);
  assert.equal(title, 'Tài liệu A');
  assert.match(html, /<h1>Tài liệu A<\/h1>/);
  assert.match(html, /<h2>Mục 1<\/h2>/);
  assert.match(html, /<table>/);
  assert.match(html, /@page/);
});

test('exportPdfs prints each markdown file to a sibling PDF with a numbered footer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-docs-'));
  writeFileSync(join(dir, '01_A.md'), '# A\n\nx');
  writeFileSync(join(dir, '02_B.md'), '# B\n\ny');
  writeFileSync(join(dir, 'notes.txt'), 'ignored');
  const printed = [];
  const fakeBrowser = {
    async newPage() {
      return {
        async setContent(html) { this.html = html; },
        async pdf(options) { printed.push({ html: this.html, options }); },
        async close() {},
      };
    },
    async close() { printed.push('closed'); },
  };
  const results = await exportPdfs(dir, ctx, { launch: async () => fakeBrowser });
  assert.deepEqual(results.map((r) => r.pdf.endsWith('.pdf')), [true, true]);
  assert.equal(printed.at(-1), 'closed');
  const [first] = printed;
  assert.equal(first.options.format, 'A4');
  assert.equal(first.options.displayHeaderFooter, true);
  assert.match(first.options.footerTemplate, /pageNumber/);
  assert.match(first.options.path, /01_A\.pdf$/);
});

test('exportPdfs closes the browser even when printing fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-docs-'));
  writeFileSync(join(dir, '01_A.md'), '# A');
  let closed = false;
  const failingBrowser = {
    async newPage() {
      return { async setContent() {}, async pdf() { throw new Error('print failed'); }, async close() {} };
    },
    async close() { closed = true; },
  };
  await assert.rejects(exportPdfs(dir, ctx, { launch: async () => failingBrowser }), /print failed/);
  assert.equal(closed, true);
});

test('the implementation plan page summarises releases, review hours and the critical path', () => {
  const model = richModel();
  const stories = [
    { id: 'ST-A-1', epic: 'EP-A', feature: 'FT-A', module: 'A', title: 'Base <slice>', release: 'R0', dependencies: [], review: { required: ['money'], hours: { min: 2, max: 4 } }, effort: { agent_hours: { min: 4, max: 8 }, confidence: 'low' }, screens: ['IAM-01'], operations: [], tables: [], acceptance: [{ id: 'AC-1', test_id: 'T' }], tasks: [{ id: 'TK-1', kind: 'qa', title: 'q' }] },
    { id: 'ST-A-2', epic: 'EP-A', feature: 'FT-A', module: 'A', title: 'Next', release: 'R1', dependencies: ['ST-A-1'], review: { required: [], hours: { min: 1, max: 2 } }, effort: { agent_hours: { min: 2, max: 5 }, confidence: 'high' }, screens: [], operations: [], tables: [], acceptance: [{ id: 'AC-2', test_id: 'T' }], tasks: [] },
  ];
  model.plan = { epics: [{ id: 'EP-A', module: 'A', title: 'Epic' }], features: [{ id: 'FT-A', epic: 'EP-A', title: 'Feature' }], stories };
  const outDir = mkdtempSync(join(tmpdir(), 'machvon-plan-'));
  buildPages(model, outDir, ctx);
  const html = readFileSync(join(outDir, 'Implementation_Plan.html'), 'utf8');
  assert.match(html, /<td>R0<\/td><td>1<\/td>/);
  assert.match(html, /Base &lt;slice&gt;/);
  assert.match(html, /ST-A-1 → ST-A-2/);
  assert.match(html, /13/, 'critical path hours (8 + 5)');
});

test('without a loaded plan the plan page is not generated', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'machvon-noplan-'));
  buildPages(richModel(), outDir, ctx);
  assert.equal(readdirSync(outDir).includes('Implementation_Plan.html'), false);
});
