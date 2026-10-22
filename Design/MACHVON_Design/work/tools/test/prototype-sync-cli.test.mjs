import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { knownKindsFromApp, findRegressions, parseScreensJs, syncMain } from '../src/prototype-sync-cli.mjs';
import { renderScreensJs } from '../src/prototype-sync.mjs';

const APP = `function state(k){if(k==='loading')return 1}
function content(){const k=cur.kind;
if(k==='dashboard')return 1;
if(['form','license'].includes(k))return form();
if(k==='kanban'||k==="board")return 2;
if(['empty','error'].includes(k))return state(k);return form()}
function paper(){return 'x'}`;

test('knownKindsFromApp reads the kinds content() dispatches on, ignoring other functions', () => {
  assert.deepEqual(knownKindsFromApp(APP), ['board', 'dashboard', 'empty', 'error', 'form', 'kanban', 'license']);
});

test('knownKindsFromApp returns nothing when content() is missing', () => {
  assert.deepEqual(knownKindsFromApp('function other(){}'), []);
});

test('parseScreensJs inverts renderScreensJs', () => {
  const screens = [{ id: 'A-01', fields: ['x'], note: "it's" }];
  assert.deepEqual(parseScreensJs(renderScreensJs(screens)), screens);
});

test('findRegressions reports removed entries, removed keys and removed list items only', () => {
  const before = [
    { id: 'A-01', title: 'T', fields: ['a', 'b'], rule: 'old' },
    { id: 'A-02', title: 'U', fields: ['a'] },
    { id: 'A-03', title: 'V', fields: ['a'], phase: 'P0' },
  ];
  const after = [
    { id: 'A-01', title: 'T', fields: ['a', 'b', 'c'], rule: 'new text' },
    { id: 'A-03', title: 'V', fields: ['b'] },
  ];
  assert.deepEqual(findRegressions(before, after), [
    { id: 'A-02', kind: 'entry' },
    { id: 'A-03', kind: 'item', key: 'fields', item: 'a' },
    { id: 'A-03', kind: 'key', key: 'phase' },
  ]);
});

function workspace({ kind = 'table' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'machvon-sync-'));
  const proto = join(root, 'proto');
  mkdirSync(proto);
  writeFileSync(join(proto, 'app.js'), APP.replace("'form','license'", "'form','license','table'"));
  writeFileSync(join(proto, 'screens.js'), renderScreensJs([{ id: 'A-01', title: 'T', kind: 'form', fields: ['a'] }]));
  writeFileSync(join(proto, 'index.html'), '<script src="screens.js?v=000000000000"></script>');
  const catalog = join(root, 'catalog.json');
  writeFileSync(catalog, JSON.stringify([
    { id: 'A-01', title: 'T', kind: 'form', fields: ['a', 'b'] },
    { id: 'A-02', title: 'U', kind, fields: [] },
  ]));
  return { proto, catalog };
}

test('syncMain regenerates screens.js from the catalog and reports a clean run', () => {
  const { proto, catalog } = workspace();
  const log = [];
  assert.equal(syncMain(['--catalog', catalog, '--prototype', proto, '--locale', 'en'], (line) => log.push(line)), 0);
  const ids = parseScreensJs(readFileSync(join(proto, 'screens.js'), 'utf8')).map((s) => s.id);
  assert.deepEqual(ids, ['A-01', 'A-02']);
  assert.doesNotMatch(readFileSync(join(proto, 'index.html'), 'utf8'), /000000000000/);
  assert.match(log.join('\n'), /2 screen/);
});

test('syncMain lists kinds the renderer does not know and exits with 1', () => {
  const { proto, catalog } = workspace({ kind: 'hologram' });
  const log = [];
  assert.equal(syncMain(['--catalog', catalog, '--prototype', proto, '--locale', 'en'], (line) => log.push(line)), 1);
  assert.match(log.join('\n'), /hologram/);
});

test('syncMain refuses to write when the catalog would drop an existing field', () => {
  const { proto, catalog } = workspace();
  writeFileSync(catalog, JSON.stringify([{ id: 'A-01', title: 'T', kind: 'form', fields: ['b'] }]));
  const before = readFileSync(join(proto, 'screens.js'), 'utf8');
  const log = [];
  assert.equal(syncMain(['--catalog', catalog, '--prototype', proto, '--locale', 'en'], (line) => log.push(line)), 1);
  assert.equal(readFileSync(join(proto, 'screens.js'), 'utf8'), before);
  assert.match(log.join('\n'), /A-01/);
});

test('syncMain accepts a first run when screens.js does not exist yet', () => {
  const { proto, catalog } = workspace();
  writeFileSync(join(proto, 'screens.js'), '');
  assert.equal(syncMain(['--catalog', catalog, '--prototype', proto, '--locale', 'en'], () => {}), 0);
});
