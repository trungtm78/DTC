import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, findBrowserExecutable } from '../src/build-cli.mjs';
import { ENGINEERING_FILES } from '../src/model.mjs';
import { validModel } from './fixtures.mjs';

function engineeringDir() {
  const model = validModel();
  const dir = mkdtempSync(join(tmpdir(), 'machvon-build-'));
  const write = (name, value) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  write(ENGINEERING_FILES.screens, model.screens);
  write(ENGINEERING_FILES.backlog, model.backlog);
  write(ENGINEERING_FILES.trace, model.trace);
  write(ENGINEERING_FILES.tests, model.tests);
  write(ENGINEERING_FILES.openapi, model.openapi);
  write(ENGINEERING_FILES.dictionary, { entities: model.entities });
  write(ENGINEERING_FILES.sql, model.sql);
  return dir;
}

test('build --pages writes the generated catalogue pages into the engineering dir', async () => {
  const dir = engineeringDir();
  const log = [];
  const code = await main(['--pages', '--dir', dir, '--date', '22/10/2026', '--baseline', '1.4'], { log: (l) => log.push(l) });
  assert.equal(code, 0);
  assert.ok(existsSync(join(dir, 'Traceability.html')));
  assert.ok(existsSync(join(dir, 'API_Catalogue.html')));
  assert.equal(log.length, 6);
});

test('build --pdf prints every numbered markdown file with the injected launcher', async () => {
  const docs = mkdtempSync(join(tmpdir(), 'machvon-build-docs-'));
  writeFileSync(join(docs, '01_A.md'), '# A');
  const printed = [];
  const launch = async () => ({
    async newPage() {
      return { async setContent() {}, async pdf(options) { printed.push(options.path); }, async close() {} };
    },
    async close() {},
  });
  const code = await main(['--pdf', '--docs', docs], { log: () => {}, launch });
  assert.equal(code, 0);
  assert.equal(printed.length, 1);
});

test('build without a target prints usage and fails', async () => {
  const log = [];
  assert.equal(await main([], { log: (l) => log.push(l) }), 2);
  assert.match(log[0], /--pages/);
});

test('findBrowserExecutable prefers an explicit path, then the first installed candidate', () => {
  assert.equal(findBrowserExecutable({ explicit: 'C:/custom/chrome.exe', exists: () => false }), 'C:/custom/chrome.exe');
  assert.equal(findBrowserExecutable({ candidates: ['a', 'b'], exists: (p) => p === 'b' }), 'b');
  assert.throws(() => findBrowserExecutable({ candidates: ['a'], exists: () => false }), /browser/i);
});
