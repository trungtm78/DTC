import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderScreensJs, refreshCacheKeys, syncPrototype, unknownKinds } from '../src/prototype-sync.mjs';

const screens = [
  { id: 'IAM-01', module: 'IAM', title: 'Đăng nhập', kind: 'auth', platform: 'web' },
  { id: 'DOC-01', module: 'DOC', title: 'Sổ văn bản đi', kind: 'table', platform: 'web' },
];

test('renderScreensJs emits the single-line SCREENS constant the prototype loads', () => {
  const js = renderScreensJs(screens);
  assert.match(js, /^const SCREENS = \[\{"id": "IAM-01"/);
  assert.ok(js.endsWith('];'), 'matches the original file, which has no trailing newline');
  const parsed = JSON.parse(js.replace(/^const SCREENS = /, '').replace(/;$/, ''));
  assert.deepEqual(parsed, screens);
});

test('refreshCacheKeys replaces version query strings with content hashes', () => {
  const html = '<link href="style.css?v=old1"><script src="screens.js?v=old2"></script><script src="other.js?v=keep"></script>';
  const out = refreshCacheKeys(html, { 'style.css': 'body{}', 'screens.js': 'const SCREENS=[];' });
  assert.doesNotMatch(out, /old1|old2/);
  assert.match(out, /style\.css\?v=[0-9a-f]{12}"/);
  assert.match(out, /other\.js\?v=keep/);
  assert.equal(refreshCacheKeys(out, { 'style.css': 'body{}', 'screens.js': 'const SCREENS=[];' }), out);
});

test('unknownKinds lists screen kinds the prototype renderer does not implement', () => {
  assert.deepEqual(unknownKinds([...screens, { id: 'X-01', kind: 'hologram' }], ['auth', 'table']), ['hologram']);
});

test('syncPrototype rewrites screens.js and the cache keys in index.html', () => {
  const dir = mkdtempSync(join(tmpdir(), 'machvon-proto-'));
  writeFileSync(join(dir, 'screens.js'), 'const SCREENS = [];\n');
  writeFileSync(join(dir, 'index.html'), '<script src="screens.js?v=aaaaaaaaaaaa"></script>');
  const result = syncPrototype(screens, dir, { knownKinds: ['auth', 'table'] });
  assert.deepEqual(result.unknownKinds, []);
  assert.match(readFileSync(join(dir, 'screens.js'), 'utf8'), /DOC-01/);
  assert.doesNotMatch(readFileSync(join(dir, 'index.html'), 'utf8'), /aaaaaaaaaaaa/);
});
