import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/merge-cli.mjs';
import { ENGINEERING_FILES } from '../src/model.mjs';
import { validModel } from './fixtures.mjs';

function workspace() {
  const model = validModel();
  const root = mkdtempSync(join(tmpdir(), 'machvon-merge-'));
  const dir = join(root, 'eng');
  const staging = join(root, 'staging');
  mkdirSync(dir);
  mkdirSync(staging);
  const write = (name, value) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  write(ENGINEERING_FILES.screens, model.screens);
  write(ENGINEERING_FILES.backlog, model.backlog);
  write(ENGINEERING_FILES.trace, model.trace);
  write(ENGINEERING_FILES.tests, model.tests);
  write(ENGINEERING_FILES.openapi, { openapi: '3.1.0', paths: model.openapi.paths, components: { schemas: {} } });
  write(ENGINEERING_FILES.dictionary, { version: '1.3', entities: model.entities });
  write(ENGINEERING_FILES.sql, model.sql);
  return { dir, staging };
}

test('merge writes fragments into the engineering sources', () => {
  const { dir, staging } = workspace();
  writeFileSync(join(staging, 'dis.json'), JSON.stringify({ module: 'DIS', screens: [{ id: 'DIS-02', module: 'DIS', req: 'FR-DIS-02' }], sql: 'CREATE TABLE x (\n  id uuid\n);' }));
  writeFileSync(join(staging, 'notes.txt'), 'ignored');
  const log = [];
  assert.equal(main(['--dir', dir, '--staging', staging], (l) => log.push(l)), 0);
  const screens = JSON.parse(readFileSync(join(dir, ENGINEERING_FILES.screens), 'utf8'));
  assert.equal(screens.length, 3);
  assert.match(readFileSync(join(dir, ENGINEERING_FILES.sql), 'utf8'), /-- BEGIN module DIS/);
  assert.match(readFileSync(join(dir, ENGINEERING_FILES.screens), 'utf8'), /^\[\n  \{/);
  assert.match(log.at(-1), /1/);
});

test('merge refuses to write anything when fragments conflict', () => {
  const { dir, staging } = workspace();
  const before = readFileSync(join(dir, ENGINEERING_FILES.tests), 'utf8');
  writeFileSync(join(staging, 'a.json'), JSON.stringify({ module: 'A', tests: [{ id: 'T9', priority: 'P1', steps: [], expected: '1' }] }));
  writeFileSync(join(staging, 'b.json'), JSON.stringify({ module: 'B', tests: [{ id: 'T9', priority: 'P1', steps: [], expected: '2' }] }));
  const log = [];
  assert.equal(main(['--dir', dir, '--staging', staging], (l) => log.push(l)), 1);
  assert.equal(readFileSync(join(dir, ENGINEERING_FILES.tests), 'utf8'), before);
  assert.match(log.join('\n'), /T9/);
});
