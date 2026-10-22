import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptCommand } from '../src/script-command.mjs';

function packageDir(scripts) {
  const dir = mkdtempSync(join(tmpdir(), 'dtc-script-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  return dir;
}

test('a simple script is split into a command and arguments without a shell', () => {
  const dir = packageDir({ test: 'node --test --test-coverage-lines=90 --test-coverage-include=src/**' });
  assert.deepEqual(scriptCommand(dir, 'test'), ['node', ['--test', '--test-coverage-lines=90', '--test-coverage-include=src/**']]);
});

test('scripts that need a shell fall back to npm run', () => {
  const dir = packageDir({ test: 'node a.js && node b.js' });
  assert.deepEqual(scriptCommand(dir, 'test'), ['npm', ['run', 'test']]);
});

test('a missing package.json or script also falls back to npm run', () => {
  assert.deepEqual(scriptCommand(mkdtempSync(join(tmpdir(), 'dtc-none-')), 'test'), ['npm', ['run', 'test']]);
  assert.deepEqual(scriptCommand(packageDir({}), 'test'), ['npm', ['run', 'test']]);
});
