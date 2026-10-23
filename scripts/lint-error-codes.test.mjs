import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintErrorCodes, main } from './lint-error-codes.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = {
  canonical: { SCOPE_DENIED: 'The actor lacks the scope (403).' },
  registry: { TENANT_CONTEXT_INVALID: { status: 400, title: 'Tenant context invalid' } },
};

function layout(files) {
  const root = mkdtempSync(join(tmpdir(), 'machvon-codes-'));
  const all = { 'registry.json': JSON.stringify(REGISTRY), ...files };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, registry: join(root, 'registry.json'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a code that is not in the registry is reported with its file (AC-ST-KERNEL-021-3)', () => {
  const fixture = layout({ 'packages/kernel/src/bad.ts': "throw new DomainError('NOT_A_CODE', 400);\n" });
  try {
    assert.deepEqual(lintErrorCodes(fixture.root, fixture.registry), [{ file: 'packages/kernel/src/bad.ts', code: 'NOT_A_CODE' }]);
  } finally {
    fixture.cleanup();
  }
});

test('canonical and registry codes pass, whatever the quote style or spacing', () => {
  const fixture = layout({
    'packages/kernel/src/ok.ts': "throw new DomainError('SCOPE_DENIED', 403);\nthrow new  DomainError(\n  \"TENANT_CONTEXT_INVALID\",\n  400,\n);\nthrow new DomainError(`SCOPE_DENIED`, 403);\n",
  });
  try {
    assert.deepEqual(lintErrorCodes(fixture.root, fixture.registry), []);
  } finally {
    fixture.cleanup();
  }
});

test('apps, nested directories and every offending occurrence are scanned; other directories and file types are not', () => {
  const fixture = layout({
    'apps/api/src/deep/a.ts': "new DomainError('FIRST_BAD', 400); new DomainError('SECOND_BAD', 400);\n",
    'packages/db/src/b.ts': "new DomainError('FIRST_BAD', 400);\n",
    'packages/db/test/c.ts': "new DomainError('IGNORED_TEST_DIR', 400);\n",
    'packages/db/src/notes.md': "new DomainError('IGNORED_MARKDOWN', 400)\n",
    'packages/db/node_modules/x/src/d.ts': "new DomainError('IGNORED_DEPENDENCY', 400);\n",
    'scripts/e.ts': "new DomainError('IGNORED_SCRIPT', 400);\n",
  });
  try {
    assert.deepEqual(lintErrorCodes(fixture.root, fixture.registry), [
      { file: 'apps/api/src/deep/a.ts', code: 'FIRST_BAD' },
      { file: 'apps/api/src/deep/a.ts', code: 'SECOND_BAD' },
      { file: 'packages/db/src/b.ts', code: 'FIRST_BAD' },
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('a root without apps or packages has nothing to lint', () => {
  const fixture = layout({});
  try {
    assert.deepEqual(lintErrorCodes(fixture.root, fixture.registry), []);
  } finally {
    fixture.cleanup();
  }
});

test('a registry file that is not valid fails loudly', () => {
  const fixture = layout({ 'bad.json': '[]' });
  try {
    assert.throws(() => lintErrorCodes(fixture.root, join(fixture.root, 'bad.json')), /registry/);
  } finally {
    fixture.cleanup();
  }
});

test('main fails on an unregistered code and passes on a registered one, in both locales (AC-ST-KERNEL-021-3)', () => {
  const bad = layout({ 'packages/kernel/src/bad.ts': "new DomainError('NOT_A_CODE', 400);\n" });
  const good = layout({ 'packages/kernel/src/ok.ts': "new DomainError('SCOPE_DENIED', 403);\n" });
  try {
    const lines = [];
    assert.equal(main(['--root', bad.root, '--registry', bad.registry, '--locale', 'en'], { log: (line) => lines.push(line) }), 1);
    assert.ok(lines.some((line) => line.includes('packages/kernel/src/bad.ts') && line.includes('NOT_A_CODE')));
    const clean = [];
    assert.equal(main(['--root', good.root, '--registry', good.registry, '--locale', 'en'], { log: (line) => clean.push(line) }), 0);
    assert.equal(clean.length, 1);
    const vi = [];
    assert.equal(main(['--root', good.root, '--registry', good.registry], { log: (line) => vi.push(line) }), 0);
    assert.notEqual(vi[0], clean[0]);
  } finally {
    bad.cleanup();
    good.cleanup();
  }
});

test('every code thrown in the current source is in the real registry', () => {
  const lines = [];
  assert.equal(main(['--root', REPO_ROOT, '--locale', 'en'], { log: (line) => lines.push(line) }), 0, lines.join('\n'));
});
