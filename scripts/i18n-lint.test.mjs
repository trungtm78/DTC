import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { i18nCheck, main } from './i18n-lint.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CATALOGUE = { 'shell.app.name.title': 'MACHVON', 'shell.nav.open.label': 'Mở' };

const CLEAN_SOURCE = `
import { useTranslation } from './i18n';
export function Page() {
  const { t } = useTranslation();
  return <main aria-label={t('shell.nav.open.label')}><h1>{t('shell.app.name.title')}</h1> / <span>•</span></main>;
}
`;

function layout(files, { vi = CATALOGUE, en = CATALOGUE } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'machvon-i18n-'));
  const all = {
    'apps/web/src/i18n/vi.json': JSON.stringify(vi),
    'apps/web/src/i18n/en.json': JSON.stringify(en),
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function check(files, catalogues) {
  const { root, cleanup } = layout(files, catalogues);
  try {
    return await i18nCheck(root);
  } finally {
    cleanup();
  }
}

const EMPTY = { missing: [], unused: [], badKeys: [], literals: [] };

test('a clean tree reports nothing (punctuation-only text and symbols are not copy)', async () => {
  assert.deepEqual(await check({ 'apps/web/src/Page.tsx': CLEAN_SOURCE }), EMPTY);
});

test('a key missing from en.json is reported with the locale', async () => {
  const result = await check({ 'apps/web/src/Page.tsx': CLEAN_SOURCE }, { en: { 'shell.app.name.title': 'MACHVON' } });
  assert.deepEqual(result.missing, ['shell.nav.open.label [en]']);
});

test('a key used in code but present in no catalogue is reported for both locales', async () => {
  const source = `${CLEAN_SOURCE}\nexport const extra = (t: (k: string) => string) => t('shell.nav.close.label');\n`;
  const result = await check({ 'apps/web/src/Page.tsx': source });
  assert.deepEqual(result.missing, ['shell.nav.close.label [vi]', 'shell.nav.close.label [en]']);
});

test('a key that breaks the module.screen.action.state pattern is reported once, wherever it appears', async () => {
  const bad = { 'shell.title': 'x', 'Shell.App.Name': 'y' };
  const source = "export const a = (t: (k: string) => string) => [t('shell.title'), t('Shell.App.Name')];\n";
  const result = await check({ 'apps/web/src/Page.tsx': source }, { vi: bad, en: bad });
  assert.deepEqual(result.badKeys, ['Shell.App.Name', 'shell.title']);
});

test('a hard-coded JSX text node and a hard-coded aria-label are reported with file and line', async () => {
  const source = `
export function Page() {
  return (
    <main aria-label="Main area" title='Tip' placeholder={'Search'} alt={\`Logo\`}>
      Welcome back
      {'More copy'}
    </main>
  );
}
`;
  const result = await check({ 'apps/web/src/Page.tsx': source });
  assert.deepEqual(result.literals, [
    'apps/web/src/Page.tsx:4 aria-label',
    'apps/web/src/Page.tsx:4 title',
    'apps/web/src/Page.tsx:4 placeholder',
    'apps/web/src/Page.tsx:4 alt',
    'apps/web/src/Page.tsx:5 text',
    'apps/web/src/Page.tsx:6 text',
  ]);
});

const fixture = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'i18n', name), 'utf8');

test('copy hidden in conditional, logical and template expressions is reported', async () => {
  const result = await check({ 'apps/web/src/Page.tsx': fixture('expression-copy.tsx.txt') });
  assert.deepEqual(result.literals, [
    'apps/web/src/Page.tsx:3 title',
    'apps/web/src/Page.tsx:3 alt',
    'apps/web/src/Page.tsx:4 text',
    'apps/web/src/Page.tsx:4 text',
    'apps/web/src/Page.tsx:5 text',
    'apps/web/src/Page.tsx:6 text',
    'apps/web/src/Page.tsx:7 text',
    'apps/web/src/Page.tsx:8 text',
  ]);
});

test('strings that are not display copy stay allowed: translated branches, comparisons, calls, class names and keys', async () => {
  assert.deepEqual(await check({ 'apps/web/src/Page.tsx': fixture('expression-allowed.tsx.txt') }), EMPTY);
});

test('attributes that carry a key lookup or no text, and other props, are not copy', async () => {
  const source = `
export function Page({ t, id }: { t: (k: string) => string; id: string }) {
  return <a href="/x" className="btn" data-id={id} aria-label={t('shell.nav.open.label')} title={t('shell.app.name.title')}>{id}</a>;
}
`;
  assert.deepEqual(await check({ 'apps/web/src/Page.tsx': source }), EMPTY);
});

test('a catalogue key that no source file uses is reported as unused, and a dynamic key prefix counts as use', async () => {
  const catalogue = { ...CATALOGUE, 'error.codeA.title.label': 'A', 'error.codeB.title.label': 'B', 'orphan.screen.action.state': 'O' };
  const source = `${CLEAN_SOURCE}\nexport const e = (t: (k: string) => string, code: string) => t(\`error.\${code}.title.label\`);\n`;
  const result = await check({ 'apps/web/src/Page.tsx': source }, { vi: catalogue, en: catalogue });
  assert.deepEqual(result.unused, ['orphan.screen.action.state']);
});

test('test files are not scanned for copy or keys', async () => {
  const test = "import { t } from './i18n';\nexport const x = () => <p>Raw words</p> && t('nope.nope.nope.nope');\n";
  assert.deepEqual(await check({ 'apps/web/src/Page.tsx': CLEAN_SOURCE, 'apps/web/src/Page.test.tsx': test }), EMPTY);
});

test('a layout without apps/web reports nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'machvon-i18n-empty-'));
  try {
    assert.deepEqual(await i18nCheck(root), EMPTY);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a catalogue that is not a flat object of strings is refused', async () => {
  const { root, cleanup } = layout({ 'apps/web/src/Page.tsx': CLEAN_SOURCE }, { vi: { shell: { app: 'nested' } } });
  try {
    await assert.rejects(() => i18nCheck(root), /vi\.json/);
  } finally {
    cleanup();
  }
});

test('main exits 1 and names every problem, 0 for a clean tree', async () => {
  const bad = layout({ 'apps/web/src/Page.tsx': '<p>Raw words</p>;\n' });
  const good = layout({ 'apps/web/src/Page.tsx': CLEAN_SOURCE });
  try {
    const lines = [];
    assert.equal(await main(['--root', bad.root], { log: (line) => lines.push(line) }), 1);
    assert.ok(lines.some((line) => line.includes('apps/web/src/Page.tsx:1')));
    assert.equal(await main(['--root', good.root], { log: () => undefined }), 0);
    const english = [];
    await main(['--root', bad.root, '--locale', 'en'], { log: (line) => english.push(line) });
    assert.ok(english.some((line) => /hard-coded/i.test(line)));
  } finally {
    bad.cleanup();
    good.cleanup();
  }
});

test('the real repository passes', async () => {
  assert.equal(await main(['--root', REPO_ROOT], { log: () => undefined }), 0);
});
