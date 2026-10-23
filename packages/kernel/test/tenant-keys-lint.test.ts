import { execFileSync } from 'node:child_process';
import path from 'node:path';

interface LintMessage {
  ruleId: string | null;
  message: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(__dirname, 'lint-fixtures');
const HELPER = path.join(__dirname, 'support', 'run-eslint.mjs');

function run(mode: 'file' | 'text', target: string, input?: string): LintMessage[] {
  const output = execFileSync(process.execPath, [HELPER, REPO_ROOT, mode, target], {
    encoding: 'utf8',
    input,
    timeout: 60_000,
  });
  const results = JSON.parse(output) as LintMessage[][];
  const first = results[0];
  if (first === undefined) throw new Error('ESLint returned no result');
  return first;
}

function kernelFile(file: string): string {
  return path.join(REPO_ROOT, 'packages/kernel', file);
}

describe('tenant key lint rule', () => {
  it('fails on raw .get/.set through store, redis and kv receivers (AC-ST-KERNEL-041-3)', () => {
    const messages = run('file', path.join(FIXTURES, 'raw-store-access.ts')).filter((m) => m.ruleId === 'no-restricted-syntax');

    expect(messages).toHaveLength(6);
    expect(messages[0]?.message).toContain('tenant-keys');
  });

  it('passes on access through TenantCache', () => {
    expect(run('file', path.join(FIXTURES, 'prefixed-store-access.ts'))).toEqual([]);
  });

  it.each([
    ['client-store-access.ts', 1],
    ['package-client-store-access.ts', 2],
    ['barrel-client-store-access.ts', 1],
    ['renamed-client-store-access.ts', 1],
    ['namespace-client-store-access.ts', 1],
    ['reexport-store-type.ts', 2],
  ])('fails when KeyValueStore is named outside its allowed homes: %s', (fixture, violations) => {
    const messages = run('file', path.join(FIXTURES, fixture)).filter((m) => m.ruleId === 'no-restricted-syntax');

    expect(messages).toHaveLength(violations);
    expect(messages[0]?.message).toContain('TenantCache');
  });

  it.each([
    "import type { KeyValueStore } from './index.ts';",
    "import type { KeyValueStore } from '../src/index.ts';",
    "import type { KeyValueStore } from '@machvon/kernel';",
    "import type { KeyValueStore } from './tenant-keys.ts';",
    "import type { KeyValueStore as Kv } from './index.ts';",
    "import { type KeyValueStore as Kv } from './index.ts';",
    "import type * as Kernel from './index.ts';\nexport type K = Kernel.KeyValueStore;",
    "export type K = import('./index.ts').KeyValueStore;",
    "export type { KeyValueStore } from './index.ts';",
    "export * from './index.ts';",
  ])('fails for the source-independent form %j in src/other.ts', (code) => {
    const messages = run('text', kernelFile('src/other.ts'), `${code}\n`);

    expect(messages.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(true);
  });

  it('allows KeyValueStore in the adapters folder, tenant-keys.ts, index.ts and tests only', () => {
    const code = "import type { KeyValueStore } from './tenant-keys.ts';\nexport type Alias = KeyValueStore;\n";

    expect(run('text', kernelFile('src/adapters/redis.ts'), code)).toEqual([]);
    expect(run('text', kernelFile('src/index.ts'), code)).toEqual([]);
    expect(run('text', kernelFile('src/tenant-keys.ts'), code)).toEqual([]);
    expect(run('text', kernelFile('test/memory-store.test.ts'), code)).toEqual([]);
    expect(run('text', kernelFile('src/other.ts'), code).map((m) => m.ruleId)).toEqual(['no-restricted-syntax']);
  });

  it('keeps the receiver-name layer active in tests', () => {
    const code = "declare const store: { get(k: string): unknown };\nstore.get('k');\n";

    const messages = run('text', kernelFile('test/x.test.ts'), code);

    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-syntax']);
  });

  it('flags this.store receivers outside tenant-keys.ts but not inside it', () => {
    const code =
      'export class X { store: { get(k: string): unknown } = { get: () => 1 }; run() { return this.store.get("k"); } }\n';

    const outside = run('text', kernelFile('src/other.ts'), code);
    const inside = run('text', kernelFile('src/tenant-keys.ts'), code);

    expect(outside.map((m) => m.ruleId)).toEqual(['no-restricted-syntax']);
    expect(inside).toEqual([]);
  });
});
